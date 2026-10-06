#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const versionFiles = [
  "package.json",
  "package-lock.json",
  "src-tauri/tauri.conf.json",
  "src-tauri/Cargo.toml",
  "src-tauri/Cargo.lock",
];
const savedFiles = new Map();
let versionsChanged = false;
let releaseCommitted = false;

function run(command, args = [], options = {}) {
  const output = execFileSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
    ...options,
  });
  return typeof output === "string" ? output.trim() : "";
}

function fail(message) {
  throw new Error(message);
}

function parseVersion(value, label = "version") {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(value);
  if (!match) fail(`${label} must be patch, minor, major, or an exact X.Y.Z version`);
  return match.slice(1).map(Number);
}

function formatVersion(parts) {
  return parts.join(".");
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function nextVersion(current, requested) {
  const parts = parseVersion(current, "Current version");
  if (["patch", "minor", "major"].includes(requested)) {
    const next = [...parts];
    const index = { major: 0, minor: 1, patch: 2 }[requested];
    next[index] += 1;
    for (let reset = index + 1; reset < next.length; reset += 1) next[reset] = 0;
    return formatVersion(next);
  }
  const exact = parseVersion(requested, "Release version");
  if (compareVersions(exact, parts) <= 0) {
    fail(`Release version ${formatVersion(exact)} must be greater than ${current}`);
  }
  return formatVersion(exact);
}

function commandExists(command) {
  try {
    run("which", [command], { capture: true });
    return true;
  } catch {
    return false;
  }
}

function packageVersion() {
  return JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
}

function manifestVersions() {
  const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
  const packageLock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
  const tauri = JSON.parse(readFileSync(join(root, "src-tauri/tauri.conf.json"), "utf8")).version;
  const cargoToml = readFileSync(join(root, "src-tauri/Cargo.toml"), "utf8")
    .match(/^\[package\][\s\S]*?^version = "([^"]+)"/m)?.[1];
  const cargoLock = readFileSync(join(root, "src-tauri/Cargo.lock"), "utf8")
    .match(/\[\[package\]\]\nname = "batbelt-desktop"\nversion = "([^"]+)"/)?.[1];
  return {
    "package.json": packageJson,
    "package-lock.json": packageLock.version,
    "package-lock.json root package": packageLock.packages?.[""]?.version,
    "src-tauri/tauri.conf.json": tauri,
    "src-tauri/Cargo.toml": cargoToml,
    "src-tauri/Cargo.lock": cargoLock,
  };
}

function assertVersions(expected) {
  const versions = manifestVersions();
  const mismatches = Object.entries(versions).filter(([, version]) => version !== expected);
  if (mismatches.length > 0) {
    fail(
      `Version mismatch; expected ${expected}:\n${mismatches
        .map(([file, version]) => `  ${file}: ${version ?? "missing"}`)
        .join("\n")}`,
    );
  }
}

function preflight(tag) {
  if (process.platform !== "darwin") fail("Desktop releases must be built on macOS");
  for (const command of ["git", "npm", "cargo", "gh"]) {
    if (!commandExists(command)) fail(`Required command not found on PATH: ${command}`);
  }
  run("gh", ["auth", "status"]);

  if (run("git", ["branch", "--show-current"], { capture: true }) !== "main") {
    fail("Releases must be created from the main branch");
  }
  if (run("git", ["status", "--porcelain"], { capture: true }) !== "") {
    fail("Working tree must be clean before releasing");
  }

  run("git", ["fetch", "--tags", "origin"]);
  const localHead = run("git", ["rev-parse", "HEAD"], { capture: true });
  const remoteHead = run("git", ["rev-parse", "origin/main"], { capture: true });
  if (localHead !== remoteHead) fail("main must be synchronized with origin/main before releasing");

  try {
    run("git", ["rev-parse", "--verify", "--quiet", `refs/tags/${tag}`], { capture: true });
    fail(`Git tag ${tag} already exists`);
  } catch (error) {
    if (error instanceof Error && error.message === `Git tag ${tag} already exists`) throw error;
  }
  try {
    run("gh", ["release", "view", tag], { capture: true });
    fail(`GitHub release ${tag} already exists`);
  } catch (error) {
    if (error instanceof Error && error.message === `GitHub release ${tag} already exists`) throw error;
  }
}

function replaceRequired(text, pattern, replacement, file) {
  if (!pattern.test(text)) fail(`Could not locate version in ${file}`);
  return text.replace(pattern, replacement);
}

function updateVersions(version) {
  for (const file of versionFiles) {
    savedFiles.set(file, readFileSync(join(root, file), "utf8"));
  }
  versionsChanged = true;

  for (const file of ["package.json", "package-lock.json", "src-tauri/tauri.conf.json"]) {
    const path = join(root, file);
    const data = JSON.parse(readFileSync(path, "utf8"));
    data.version = version;
    if (file === "package-lock.json" && data.packages?.[""]) data.packages[""].version = version;
    writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
  }

  const cargoTomlPath = join(root, "src-tauri/Cargo.toml");
  const cargoToml = readFileSync(cargoTomlPath, "utf8");
  writeFileSync(
    cargoTomlPath,
    replaceRequired(
      cargoToml,
      /(^\[package\][\s\S]*?^version = ")[^"]+(")/m,
      `$1${version}$2`,
      "src-tauri/Cargo.toml",
    ),
  );

  const cargoLockPath = join(root, "src-tauri/Cargo.lock");
  const cargoLock = readFileSync(cargoLockPath, "utf8");
  writeFileSync(
    cargoLockPath,
    replaceRequired(
      cargoLock,
      /(\[\[package\]\]\nname = "batbelt-desktop"\nversion = ")[^"]+(")/,
      `$1${version}$2`,
      "src-tauri/Cargo.lock",
    ),
  );
  assertVersions(version);
}

function restoreVersions() {
  if (!versionsChanged || releaseCommitted) return;
  for (const [file, contents] of savedFiles) writeFileSync(join(root, file), contents);
  versionsChanged = false;
  console.error("Restored version files after the failed release.");
}

function findDmgs(directory) {
  if (!statSafe(directory)?.isDirectory()) return [];
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    const stat = statSafe(path);
    if (stat?.isDirectory()) return findDmgs(path);
    return name.endsWith(".dmg") ? [path] : [];
  });
}

function statSafe(path) {
  try {
    return statSync(path);
  } catch {
    return undefined;
  }
}

function buildDesktop() {
  run("npm", ["run", "typecheck"]);
  run("npm", ["test"]);
  const dmgDirectory = join(root, "src-tauri/target/release/bundle/dmg");
  rmSync(dmgDirectory, { recursive: true, force: true });
  run("npm", ["run", "desktop"]);
  const dmgs = findDmgs(dmgDirectory);
  if (dmgs.length !== 1) {
    fail(`Expected exactly one DMG in ${relative(root, dmgDirectory)}, found ${dmgs.length}`);
  }
  return dmgs[0];
}

function publish(version, dmg) {
  const tag = `v${version}`;
  run("git", ["add", ...versionFiles]);
  run("git", ["commit", "-m", `Release ${tag}`]);
  releaseCommitted = true;
  run("git", ["tag", "-a", tag, "-m", `Release ${tag}`]);

  try {
    run("git", ["push", "origin", "main"]);
    run("git", ["push", "origin", tag]);
    run("gh", [
      "release",
      "create",
      tag,
      dmg,
      "--title",
      tag,
      "--generate-notes",
      "--verify-tag",
    ]);
  } catch (error) {
    console.error(`\nRelease publishing did not finish. Do not rewrite pushed history.`);
    console.error(
      `After fixing the problem, retry:\n  git push origin main\n  git push origin ${tag}\n  gh release create ${tag} "${relative(root, dmg)}" --title "${tag}" --generate-notes --verify-tag`,
    );
    throw error;
  }
}

const requested = process.argv[2];
if (!requested || process.argv.length !== 3) {
  console.error("Usage: npm run release -- <patch|minor|major|X.Y.Z>");
  process.exit(1);
}

try {
  const current = packageVersion();
  assertVersions(current);
  const version = nextVersion(current, requested);
  const tag = `v${version}`;
  console.log(`Preparing ${tag} from v${current}`);
  preflight(tag);
  updateVersions(version);
  const dmg = buildDesktop();
  publish(version, dmg);
  console.log(`Published ${tag}: ${relative(root, dmg)}`);
} catch (error) {
  restoreVersions();
  console.error(`Release failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

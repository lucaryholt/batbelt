import { spawn } from "node:child_process";
import { access, constants, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, delimiter, dirname, join } from "node:path";
import { expandListenOn } from "./expand-path.js";
import type { DirTool, TerminalConfig } from "./modules/homepage/types.js";

export interface OpenResult {
  path: string;
  fallback?: "kitty-window";
}

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface OpenLocalDeps {
  spawnDetached?: (bin: string, args: string[]) => Promise<void>;
  runCommand?: (bin: string, args: string[]) => Promise<CommandResult>;
  runOsascript?: (script: string) => Promise<void>;
  lookPath?: (bin: string) => Promise<boolean>;
}

export function appleScriptStringLiteral(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

export function terminalAppScript(absDir: string): string {
  return [
    `set dirPath to ${appleScriptStringLiteral(absDir)}`,
    `tell application "Terminal"`,
    `  activate`,
    `  do script ("cd " & quoted form of dirPath & " && exec pi")`,
    `end tell`,
  ].join("\n");
}

// A GUI-launched Kitty only has a bare PATH (plus its own bundle), so a program
// started through remote control cannot find `pi`, nor the `node` its shebang
// needs. The server's PATH comes from the login shell, so hand that over.
export function kittyRemoteArgs(absDir: string, listenOn?: string, path = process.env.PATH): string[] {
  const args = ["@"];
  if (listenOn) args.push("--to", listenOn);
  args.push("launch", "--type=tab", "--cwd", absDir);
  if (path) args.push("--env", `PATH=${path}`);
  args.push("--", "pi");
  return args;
}

export function kittyWindowArgs(absDir: string): string[] {
  return ["--directory", absDir, "-e", "pi"];
}

// Kitty.app ships its binaries inside the bundle and only puts them on PATH for
// shells it starts itself, so a server launched from Finder never sees them.
export function kittyBinCandidates(bin: "kitten" | "kitty", home = homedir()): string[] {
  return [
    bin,
    join("/Applications", "kitty.app", "Contents", "MacOS", bin),
    join(home, "Applications", "kitty.app", "Contents", "MacOS", bin),
  ];
}

async function firstOnPath(
  candidates: string[],
  which: (bin: string) => Promise<boolean>,
): Promise<string> {
  for (const candidate of candidates) {
    if (await which(candidate)) return candidate;
  }
  return "";
}

// `listen_on unix:/tmp/mykitty` makes kitty create /tmp/mykitty-<pid>, so the
// configured address has to be mapped onto the socket that actually exists.
export async function resolveKittySocket(listenOn: string, home = homedir()): Promise<string> {
  if (!listenOn.startsWith("unix:")) return listenOn;
  const socket = expandListenOn(listenOn.slice("unix:".length), home);
  if (socket.startsWith("@")) return listenOn;
  if (await pathExists(socket)) return `unix:${socket}`;

  const prefix = `${basename(socket)}-`;
  let names: string[];
  try {
    names = await readdir(dirname(socket));
  } catch {
    return `unix:${socket}`;
  }
  const matches = names.filter((name) => name.startsWith(prefix) && /^\d+$/.test(name.slice(prefix.length)));
  const dated = await Promise.all(
    matches.map(async (name) => {
      const full = join(dirname(socket), name);
      try {
        return { full, mtime: (await stat(full)).mtimeMs };
      } catch {
        return { full, mtime: -1 };
      }
    }),
  );
  const newest = dated.sort((a, b) => b.mtime - a.mtime)[0];
  return newest ? `unix:${newest.full}` : `unix:${socket}`;
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export function substituteArgv(argv: string[], absDir: string, cmd = "pi"): string[] {
  return argv.map((token) => token.replaceAll("{path}", absDir).replaceAll("{cmd}", cmd));
}

export async function lookPath(bin: string): Promise<boolean> {
  if (bin.includes("/") || bin.includes("\\")) {
    try {
      await access(bin, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    try {
      await access(join(dir, bin), constants.X_OK);
      return true;
    } catch {
      /* continue */
    }
  }
  return false;
}

function missingBinaryMessage(bin: string): string {
  if (bin === "code") {
    return "`code` was not found on PATH. Install the VS Code shell command.";
  }
  if (bin === "pi") {
    return "`pi` was not found on PATH.";
  }
  if (bin === "kitten" || bin === "kitty") {
    return "`kitten`/`kitty` was not found on PATH. Install Kitty or pick another Pi terminal.";
  }
  return `\`${bin}\` was not found on PATH.`;
}

function isEnoent(err: unknown): boolean {
  return (err as NodeJS.ErrnoException).code === "ENOENT";
}

export async function spawnDetached(bin: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(bin, args, { stdio: "ignore", detached: true });
    child.on("error", (err) => {
      if (isEnoent(err)) {
        reject(new Error(missingBinaryMessage(bin)));
        return;
      }
      reject(err);
    });
    child.on("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

export async function runCommand(bin: string, args: string[]): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => {
      if (isEnoent(err)) {
        reject(new Error(missingBinaryMessage(bin)));
        return;
      }
      reject(err);
    });
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

async function runOsascript(script: string): Promise<void> {
  const result = await runCommand("osascript", ["-e", script]);
  if (result.code !== 0) {
    throw new Error((result.stderr || result.stdout || "osascript failed").trim());
  }
}

async function openGui(bin: DirTool, absDir: string, spawnFn: (bin: string, args: string[]) => Promise<void>): Promise<OpenResult> {
  await spawnFn(bin, [absDir]);
  return { path: absDir };
}

async function openKittyTab(
  absDir: string,
  terminal: Extract<TerminalConfig, { kind: "kitty-tab" }>,
  deps: Required<Pick<OpenLocalDeps, "spawnDetached" | "runCommand" | "lookPath">>,
): Promise<OpenResult> {
  const listenOn = terminal.listenOn ? await resolveKittySocket(terminal.listenOn) : undefined;
  const remoteBin = await firstOnPath(
    [...kittyBinCandidates("kitten"), ...kittyBinCandidates("kitty")],
    deps.lookPath,
  );
  if (!remoteBin) {
    throw new Error(missingBinaryMessage("kitten"));
  }
  const remote = await deps.runCommand(remoteBin, kittyRemoteArgs(absDir, listenOn));
  if (remote.code === 0) return { path: absDir };

  const windowBin = (await firstOnPath(kittyBinCandidates("kitty"), deps.lookPath)) || "kitty";
  try {
    await deps.spawnDetached(windowBin, kittyWindowArgs(absDir));
  } catch (err) {
    const detail = (remote.stderr || remote.stdout || `exit ${remote.code}`).trim();
    throw new Error(
      `Kitty remote control failed (${detail}). Also could not open a Kitty window: ${(err as Error).message}`,
    );
  }
  return { path: absDir, fallback: "kitty-window" };
}

export async function openDirectory(
  input: { path: string; tool: DirTool; terminal: TerminalConfig },
  deps: OpenLocalDeps = {},
): Promise<OpenResult> {
  const spawnFn = deps.spawnDetached ?? spawnDetached;
  const run = deps.runCommand ?? runCommand;
  const osa = deps.runOsascript ?? runOsascript;
  const which = deps.lookPath ?? lookPath;
  const absDir = input.path;

  if (input.tool === "code") {
    return openGui(input.tool, absDir, spawnFn);
  }

  if (input.terminal.kind === "kitty-tab") {
    return openKittyTab(absDir, input.terminal, {
      spawnDetached: spawnFn,
      runCommand: run,
      lookPath: which,
    });
  }
  if (input.terminal.kind === "terminal-app") {
    await osa(terminalAppScript(absDir));
    return { path: absDir };
  }

  const argv = substituteArgv(input.terminal.argv, absDir);
  await spawnFn(argv[0], argv.slice(1));
  return { path: absDir };
}

export const TOOL_NAMES = ["code", "pi", "kitten", "kitty"] as const;

export async function detectTools(
  which: (bin: string) => Promise<boolean> = lookPath,
): Promise<Record<(typeof TOOL_NAMES)[number], boolean>> {
  const entries = await Promise.all(
    TOOL_NAMES.map(async (name) => {
      const candidates = name === "kitten" || name === "kitty" ? kittyBinCandidates(name) : [name];
      return [name, (await firstOnPath(candidates, which)) !== ""] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<(typeof TOOL_NAMES)[number], boolean>;
}

import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DEFAULT_MODULE_IDS } from "./catalog.js";
import { modulesFilePath, parseEnabledIds, parseHostConfig, resolveEnabledIds, resolveHostConfig } from "./enabled.js";

describe("enabled modules", () => {
  const prev = process.env.XDG_CONFIG_HOME;
  let dir: string;

  afterEach(() => {
    if (prev === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = prev;
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  function isolate(): void {
    dir = mkdtempSync(join(tmpdir(), "batbelt-modules-"));
    process.env.XDG_CONFIG_HOME = dir;
  }

  function writeModulesYaml(body: string): void {
    const path = modulesFilePath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, body);
  }

  it("treats a missing file as the full catalog in default order", async () => {
    isolate();
    await expect(resolveEnabledIds()).resolves.toEqual([...DEFAULT_MODULE_IDS]);
  });

  it("loads a subset in YAML order", async () => {
    isolate();
    writeModulesYaml("enabled:\n  - prlooker\n  - homepage\n");
    await expect(resolveEnabledIds()).resolves.toEqual(["prlooker", "homepage"]);
  });

  it("allows an empty enabled list", async () => {
    isolate();
    writeModulesYaml("enabled: []\n");
    await expect(resolveEnabledIds()).resolves.toEqual([]);
  });

  it("rejects an unknown id", () => {
    expect(() => parseEnabledIds({ enabled: ["homepage", "nope"] })).toThrow(
      /Unknown module id: nope\. Known ids: homepage, kubefwd, steamer, kickflip, prlooker/,
    );
  });

  it("rejects duplicate ids", () => {
    expect(() => parseEnabledIds({ enabled: ["homepage", "homepage"] })).toThrow(
      "Duplicate module id: homepage",
    );
  });

  it("defaults typeToSearch to true when the key is omitted", () => {
    expect(parseHostConfig({ enabled: ["homepage"] })).toEqual({
      ids: ["homepage"],
      typeToSearch: true,
    });
  });

  it("accepts typeToSearch false", () => {
    expect(parseHostConfig({ enabled: ["homepage"], typeToSearch: false })).toEqual({
      ids: ["homepage"],
      typeToSearch: false,
    });
  });

  it("rejects a non-boolean typeToSearch", () => {
    expect(() => parseHostConfig({ enabled: ["homepage"], typeToSearch: "yes" })).toThrow(
      /typeToSearch must be a boolean/,
    );
  });

  it("treats a missing file as typeToSearch true", async () => {
    isolate();
    await expect(resolveHostConfig()).resolves.toEqual({
      ids: [...DEFAULT_MODULE_IDS],
      typeToSearch: true,
    });
  });
});

import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { emptyConfig, loadConfig, normalizeConfig, saveConfig } from "./config.js";
import { configFilePath } from "./paths.js";

describe("prlooker config", () => {
  const prev = process.env.XDG_CONFIG_HOME;
  let dir: string;

  afterEach(() => {
    if (prev === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = prev;
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  function isolate(): void {
    dir = mkdtempSync(join(tmpdir(), "batbelt-prlooker-"));
    process.env.XDG_CONFIG_HOME = dir;
  }

  it("loads missing and empty files as defaults", async () => {
    isolate();
    await expect(loadConfig()).resolves.toEqual(emptyConfig());
    const path = configFilePath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "");
    await expect(loadConfig()).resolves.toEqual({ pollSeconds: 60, teams: [] });
  });

  it("accepts teams and pollSeconds", () => {
    expect(
      normalizeConfig({
        pollSeconds: 90,
        teams: ["myorg/platform", "myorg/platform", "acme/infra"],
      }),
    ).toEqual({ pollSeconds: 90, teams: ["myorg/platform", "acme/infra"] });
  });

  it("rejects a short poll interval", () => {
    expect(() => normalizeConfig({ pollSeconds: 15 })).toThrow(/pollSeconds/);
  });

  it("rejects a team slug that is not org/team", () => {
    expect(() => normalizeConfig({ teams: ["platform"] })).toThrow(/org\/team/);
  });

  it("round-trips YAML", async () => {
    isolate();
    const saved = await saveConfig({ pollSeconds: 120, teams: ["acme/core"] });
    expect(saved).toEqual({ pollSeconds: 120, teams: ["acme/core"] });
    expect(await loadConfig()).toEqual(saved);
  });
});

import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  findService,
  loadConfig,
  normalizeConfig,
  seedDefaultConfig,
  writeSeedIfMissing,
} from "./config.js";
import { configFilePath } from "./paths.js";

describe("kickflip config", () => {
  const prev = process.env.XDG_CONFIG_HOME;
  let dir: string;

  afterEach(() => {
    if (prev === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = prev;
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("seeds generic example services and default context", () => {
    const seed = seedDefaultConfig();
    expect(seed.contexts).toEqual([
      { name: "dev", context: "kind-dev", default: true },
      { name: "prod", context: "kind-prod" },
    ]);
    expect(seed.namespaces.map((ns) => ns.name)).toEqual(["a-team", "b-team"]);
    expect(seed.namespaces[0].services.map((svc) => svc.name)).toEqual(["svc-1", "svc-2"]);
    expect(seed.namespaces[1].services).toEqual([{ name: "gateway", external_secret: "gateway-env" }]);
    expect(findService(seed, "svc-1" as never, "svc-1")).toBeUndefined();
    expect(findService(seed, "a-team", "svc-1")).toEqual({
      name: "svc-1",
      namespace: "a-team",
      externalSecret: "svc-1-env",
      deployment: "svc-1",
    });
    expect(findService(seed, "b-team", "gateway")?.externalSecret).toBe("gateway-env");
  });

  it("writes the seed only when the YAML file is missing", async () => {
    dir = mkdtempSync(join(tmpdir(), "batbelt-kickflip-"));
    process.env.XDG_CONFIG_HOME = dir;
    expect(await writeSeedIfMissing()).toBe(true);
    const first = readFileSync(configFilePath(), "utf8");
    writeFileSync(configFilePath(), "contexts:\n  - name: kept\n    context: kept-ctx\n    default: true\n");
    expect(await writeSeedIfMissing()).toBe(false);
    expect(readFileSync(configFilePath(), "utf8")).not.toBe(first);
    expect(readFileSync(configFilePath(), "utf8")).toMatch(/kept-ctx/);
  });

  it("errors on a missing config instead of reseeding", async () => {
    dir = mkdtempSync(join(tmpdir(), "batbelt-kickflip-"));
    process.env.XDG_CONFIG_HOME = dir;
    await expect(loadConfig()).rejects.toThrow(/not found/);
  });

  it("rejects two default contexts", () => {
    expect(() =>
      normalizeConfig({
        contexts: [
          { name: "a", context: "ctx-a", default: true },
          { name: "b", context: "ctx-b", default: true },
        ],
        namespaces: [],
      }),
    ).toThrow(/one context/i);
  });
});

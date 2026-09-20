import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import type { Config, ConfigStore } from "./types.js";
import { dumpConfigYaml, parseConfigYaml } from "./parse.js";

export class FileConfigStore implements ConfigStore {
  readonly writable = false;

  constructor(readonly path: string) {}

  description(): string {
    return this.path;
  }

  load(): Config {
    let data: string;
    try {
      data = readFileSync(this.path, "utf8");
    } catch (err) {
      throw new Error(`failed to read config file: ${err instanceof Error ? err.message : String(err)}`);
    }
    try {
      return parseConfigYaml(data);
    } catch (err) {
      throw new Error(`failed to parse config file: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  save(cfg: Config): void {
    const out = dumpConfigYaml(cfg);
    const dir = dirname(this.path);
    mkdirSync(dir, { recursive: true });
    const tmp = join(dir, `.kubefwd-${randomBytes(6).toString("hex")}.yaml`);
    try {
      writeFileSync(tmp, out, "utf8");
      renameSync(tmp, this.path);
    } catch (err) {
      try {
        unlinkSync(tmp);
      } catch {
        /* ignore */
      }
      throw new Error(`replace config file: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

export function defaultConfigPath(): string {
  const home = process.env.HOME || tmpdir();
  return join(home, ".kubefwd.yaml");
}

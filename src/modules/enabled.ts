import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import { configDir } from "../paths.js";
import {
  DEFAULT_MODULE_IDS,
  isCatalogModuleId,
  knownModuleIds,
  modulesForIds,
} from "./catalog.js";
import type { BatbeltModule } from "./types.js";

export function modulesFilePath(): string {
  return join(configDir(), "modules.yaml");
}

export interface HostModulesConfig {
  ids: string[];
  typeToSearch: boolean;
}

const DEFAULT_HOST: HostModulesConfig = {
  ids: [...DEFAULT_MODULE_IDS],
  typeToSearch: true,
};

let cachedHost: HostModulesConfig = DEFAULT_HOST;

export function getHostModulesConfig(): HostModulesConfig {
  return cachedHost;
}

export function parseEnabledIds(raw: unknown): string[] {
  return parseHostConfig(raw).ids;
}

export function parseHostConfig(raw: unknown): HostModulesConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("modules.yaml must be a mapping with an enabled list");
  }
  const row = raw as { enabled?: unknown; typeToSearch?: unknown };
  const enabled = row.enabled;
  if (!Array.isArray(enabled)) {
    throw new Error("modules.yaml enabled must be an array of module ids");
  }

  const ids: string[] = [];
  const seen = new Set<string>();
  for (const [index, item] of enabled.entries()) {
    if (typeof item !== "string" || !item.trim()) {
      throw new Error(`modules.yaml enabled[${index}] must be a non-empty string`);
    }
    const id = item.trim();
    if (seen.has(id)) {
      throw new Error(`Duplicate module id: ${id}`);
    }
    if (!isCatalogModuleId(id)) {
      throw new Error(`Unknown module id: ${id}. Known ids: ${knownModuleIds()}`);
    }
    seen.add(id);
    ids.push(id);
  }

  if (!Object.hasOwn(row, "typeToSearch") || row.typeToSearch === undefined) {
    return { ids, typeToSearch: true };
  }
  if (typeof row.typeToSearch !== "boolean") {
    throw new Error("modules.yaml typeToSearch must be a boolean");
  }
  return { ids, typeToSearch: row.typeToSearch };
}

export async function resolveHostConfig(): Promise<HostModulesConfig> {
  const path = modulesFilePath();
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      cachedHost = DEFAULT_HOST;
      return cachedHost;
    }
    throw err;
  }

  let raw: unknown;
  try {
    raw = parse(text);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid modules.yaml: ${message}`);
  }

  if (raw == null) {
    throw new Error("modules.yaml enabled must be an array of module ids");
  }
  cachedHost = parseHostConfig(raw);
  return cachedHost;
}

export async function resolveEnabledIds(): Promise<string[]> {
  return (await resolveHostConfig()).ids;
}

export async function resolveEnabledModules(): Promise<BatbeltModule[]> {
  return modulesForIds(await resolveEnabledIds());
}

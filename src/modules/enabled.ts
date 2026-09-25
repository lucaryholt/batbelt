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

export function parseEnabledIds(raw: unknown): string[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("modules.yaml must be a mapping with an enabled list");
  }
  const enabled = (raw as { enabled?: unknown }).enabled;
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
  return ids;
}

export async function resolveEnabledIds(): Promise<string[]> {
  const path = modulesFilePath();
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return [...DEFAULT_MODULE_IDS];
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
  return parseEnabledIds(raw);
}

export async function resolveEnabledModules(): Promise<BatbeltModule[]> {
  return modulesForIds(await resolveEnabledIds());
}

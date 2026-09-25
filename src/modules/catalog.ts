import type { BatbeltModule } from "./types.js";
import { homepageModule } from "./homepage/index.js";
import { kubefwdModule } from "./kubefwd/index.js";
import { steamerModule } from "./steamer/index.js";
import { kickflipModule } from "./kickflip/index.js";
import { prlookerModule } from "./prlooker/index.js";

export const DEFAULT_MODULE_IDS = [
  "homepage",
  "kubefwd",
  "steamer",
  "kickflip",
  "prlooker",
] as const;

export type CatalogModuleId = (typeof DEFAULT_MODULE_IDS)[number];

const catalog: Record<CatalogModuleId, BatbeltModule> = {
  homepage: homepageModule,
  kubefwd: kubefwdModule,
  steamer: steamerModule,
  kickflip: kickflipModule,
  prlooker: prlookerModule,
};

export function isCatalogModuleId(id: string): id is CatalogModuleId {
  return (DEFAULT_MODULE_IDS as readonly string[]).includes(id);
}

export function knownModuleIds(): string {
  return DEFAULT_MODULE_IDS.join(", ");
}

export function modulesForIds(ids: readonly string[]): BatbeltModule[] {
  return ids.map((id) => {
    if (!isCatalogModuleId(id)) {
      throw new Error(`Unknown module id: ${id}. Known ids: ${knownModuleIds()}`);
    }
    return catalog[id];
  });
}

import type { BatbeltModule } from "./types.js";

const modules: BatbeltModule[] = [];

export function registerModule(mod: BatbeltModule): void {
  if (modules.some((existing) => existing.id === mod.id)) {
    throw new Error(`Module already registered: ${mod.id}`);
  }
  modules.push(mod);
}

export function getModules(): BatbeltModule[] {
  return modules;
}

export function getModule(id: string): BatbeltModule | undefined {
  return modules.find((mod) => mod.id === id);
}

import type { Hono } from "hono";

export interface ModulePage {
  id: string;
  label: string;
  path: string;
}

export interface ModuleAction {
  id: string;
  label: string;
  description: string;
  keywords?: string[];
  method: "POST";
  path: string;
  successMessage: string;
}

export interface ModuleContext {
  configDir: string;
  port: number;
  dbPath: string;
  importYaml?: string;
  debug: boolean;
  open: boolean;
  startDefaults: boolean;
  startDefaultProxies: boolean;
}

export interface BatbeltModule {
  id: string;
  title: string;
  pages: ModulePage[];
  actions?: ModuleAction[];
  createRoutes(): Hono;
  start?(ctx: ModuleContext): Promise<void>;
  stop?(): Promise<void>;
}

export interface ModuleDescriptor {
  id: string;
  title: string;
  pages: ModulePage[];
  actions: ModuleAction[];
}

export function toDescriptor(mod: BatbeltModule): ModuleDescriptor {
  return { id: mod.id, title: mod.title, pages: mod.pages, actions: mod.actions ?? [] };
}

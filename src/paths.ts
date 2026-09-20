import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const APP_DIR_NAME = "batbelt";
export const DEFAULT_PORT = 3870;

export function configDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg) return join(xdg, APP_DIR_NAME);
  return join(homedir(), ".config", APP_DIR_NAME);
}

export function defaultDbPath(): string {
  return join(configDir(), "kubefwd.db");
}

export function ensureConfigDir(): string {
  const dir = configDir();
  mkdirSync(dir, { recursive: true });
  return dir;
}

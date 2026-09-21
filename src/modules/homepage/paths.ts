import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const APP_DIR_NAME = "batbelt";
export const HOMEPAGE_DIR_NAME = "homepage";

export function configDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg) return join(xdg, APP_DIR_NAME, HOMEPAGE_DIR_NAME);
  return join(homedir(), ".config", APP_DIR_NAME, HOMEPAGE_DIR_NAME);
}

export function configFilePath(): string {
  return join(configDir(), "config.yaml");
}

export async function ensureAppDirs(): Promise<void> {
  await mkdir(configDir(), { recursive: true, mode: 0o700 });
}

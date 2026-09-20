import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const APP_DIR_NAME = "batbelt";
export const STEAMER_DIR_NAME = "steamer";

export function configDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg) return join(xdg, APP_DIR_NAME, STEAMER_DIR_NAME);
  return join(homedir(), ".config", APP_DIR_NAME, STEAMER_DIR_NAME);
}

export function configFilePath(): string {
  return join(configDir(), "config.yaml");
}

export function tokensDir(): string {
  return join(configDir(), "tokens");
}

export function sanitizeEnvName(name: string): string {
  const cleaned = name.trim().replace(/[^a-zA-Z0-9._-]/g, "_");
  if (!cleaned || cleaned === "." || cleaned === "..") {
    throw new Error("Invalid environment name");
  }
  return cleaned;
}

export function tokenPath(envName: string): string {
  return join(tokensDir(), sanitizeEnvName(envName));
}

export async function ensureAppDirs(): Promise<void> {
  await mkdir(configDir(), { recursive: true, mode: 0o700 });
  await mkdir(tokensDir(), { recursive: true, mode: 0o700 });
}

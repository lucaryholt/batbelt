import { chmod, readFile, writeFile } from "node:fs/promises";
import { parse, stringify } from "yaml";
import type { AppConfig, Environment } from "./types.js";
import { configFilePath, ensureAppDirs } from "./paths.js";

const emptyConfig = (): AppConfig => ({ environments: [] });

function normalizeEnv(raw: unknown, index: number): Environment {
  if (!raw || typeof raw !== "object") {
    throw new Error(`Environment ${index} is invalid`);
  }
  const env = raw as Record<string, unknown>;
  const name = String(env.name ?? "").trim();
  const addr = String(env.addr ?? "").trim();
  if (!name) throw new Error(`Environment ${index} is missing a name`);
  if (!addr) throw new Error(`Environment "${name}" is missing an address`);
  return {
    name,
    addr: addr.replace(/\/+$/, ""),
    namespace: env.namespace ? String(env.namespace) : "",
    oidcMount: env.oidcMount ? String(env.oidcMount) : "oidc",
    oidcRole: env.oidcRole ? String(env.oidcRole) : "",
    kvMount: env.kvMount ? String(env.kvMount) : "secret",
  };
}

export function normalizeConfig(raw: unknown): AppConfig {
  if (!raw || typeof raw !== "object") return emptyConfig();
  const environments = Array.isArray((raw as AppConfig).environments)
    ? (raw as AppConfig).environments.map(normalizeEnv)
    : [];
  const names = new Set<string>();
  for (const env of environments) {
    const key = env.name.toLowerCase();
    if (names.has(key)) {
      throw new Error(`Duplicate environment name: ${env.name}`);
    }
    names.add(key);
  }
  return { environments };
}

export async function loadConfig(): Promise<AppConfig> {
  await ensureAppDirs();
  try {
    const text = await readFile(configFilePath(), "utf8");
    return normalizeConfig(parse(text));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return emptyConfig();
    throw err;
  }
}

export async function saveConfig(config: AppConfig): Promise<AppConfig> {
  const normalized = normalizeConfig(config);
  await ensureAppDirs();
  const body = stringify(normalized);
  await writeFile(configFilePath(), body, { mode: 0o600 });
  await chmod(configFilePath(), 0o600);
  return normalized;
}

export async function findEnvironment(name: string): Promise<Environment> {
  const config = await loadConfig();
  const env = config.environments.find(
    (item) => item.name.toLowerCase() === name.toLowerCase(),
  );
  if (!env) throw new Error(`Unknown environment: ${name}`);
  return env;
}

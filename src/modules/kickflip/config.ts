import { access, chmod, readFile, writeFile } from "node:fs/promises";
import { stringify, parse } from "yaml";
import type {
  ClusterContext,
  KickflipConfig,
  NamespaceConfig,
  ResolvedService,
  ServiceConfig,
} from "./types.js";
import { configFilePath, ensureAppDirs } from "./paths.js";

const SCRIPT_CONTEXT = "gke_gowish-devx_europe-west1_api-eu";

const PERSONALIZATION = [
  "brands",
  "creators",
  "activity",
  "partners",
  "product-updates",
  "products",
  "reactions",
  "recommendations",
  "wish-genie",
];

const ACTIVATION = [
  "audiences",
  "cards",
  "followers",
  "notifications",
  "occasions",
  "sharing",
  "tracking",
  "users",
];

const WISHING = ["search", "wishlists"];

function named(names: string[]): ServiceConfig[] {
  return names.map((name) => ({ name }));
}

export function seedDefaultConfig(): KickflipConfig {
  return {
    contexts: [{ name: "dev", context: SCRIPT_CONTEXT, default: true }],
    namespaces: [
      { name: "personalization-service", services: named(PERSONALIZATION) },
      { name: "activation-service", services: named(ACTIVATION) },
      { name: "wishing-experience", services: named(WISHING) },
      {
        name: "graphql-gateway",
        services: [{ name: "gateway", external_secret: "gateway-env" }],
      },
    ],
  };
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value as Record<string, unknown>;
}

function normalizeService(raw: unknown, namespace: string, index: number): ServiceConfig {
  const row = asRecord(raw, `Service ${index} in ${namespace}`);
  const name = String(row.name ?? "").trim();
  if (!name) throw new Error(`Service ${index} in ${namespace} is missing a name`);
  const service: ServiceConfig = { name };
  const secret = String(row.external_secret ?? "").trim();
  if (secret) service.external_secret = secret;
  const deployment = String(row.deployment ?? "").trim();
  if (deployment) service.deployment = deployment;
  return service;
}

function normalizeNamespace(raw: unknown, index: number): NamespaceConfig {
  const row = asRecord(raw, `Namespace ${index}`);
  const name = String(row.name ?? "").trim();
  if (!name) throw new Error(`Namespace ${index} is missing a name`);
  const services = Array.isArray(row.services)
    ? row.services.map((svc, i) => normalizeService(svc, name, i))
    : [];
  const seen = new Set<string>();
  for (const svc of services) {
    const key = svc.name.toLowerCase();
    if (seen.has(key)) throw new Error(`Duplicate service ${svc.name} in ${name}`);
    seen.add(key);
  }
  return { name, services };
}

function normalizeContext(raw: unknown, index: number): ClusterContext {
  const row = asRecord(raw, `Context ${index}`);
  const name = String(row.name ?? "").trim();
  const context = String(row.context ?? "").trim();
  if (!name) throw new Error(`Context ${index} is missing a name`);
  if (!context) throw new Error(`Context "${name}" is missing a kubectl context`);
  return {
    name,
    context,
    default: row.default === true,
  };
}

export function normalizeConfig(raw: unknown): KickflipConfig {
  const row = asRecord(raw, "Kickflip config");
  const contexts = Array.isArray(row.contexts) ? row.contexts.map(normalizeContext) : [];
  if (!contexts.length) throw new Error("At least one context is required");
  const names = new Set<string>();
  const kubeContexts = new Set<string>();
  for (const ctx of contexts) {
    const key = ctx.name.toLowerCase();
    if (names.has(key)) throw new Error(`Duplicate context name: ${ctx.name}`);
    names.add(key);
    if (kubeContexts.has(ctx.context)) throw new Error(`Duplicate kubectl context: ${ctx.context}`);
    kubeContexts.add(ctx.context);
  }
  const defaults = contexts.filter((ctx) => ctx.default);
  if (defaults.length > 1) throw new Error("Only one context can be default");
  if (defaults.length === 0) contexts[0].default = true;

  const namespaces = Array.isArray(row.namespaces) ? row.namespaces.map(normalizeNamespace) : [];
  const nsNames = new Set<string>();
  for (const ns of namespaces) {
    const key = ns.name.toLowerCase();
    if (nsNames.has(key)) throw new Error(`Duplicate namespace: ${ns.name}`);
    nsNames.add(key);
  }
  return { contexts, namespaces };
}

export function defaultContext(config: KickflipConfig): ClusterContext {
  return config.contexts.find((ctx) => ctx.default) ?? config.contexts[0];
}

export function findContext(config: KickflipConfig, context: string): ClusterContext | undefined {
  return config.contexts.find((ctx) => ctx.context === context || ctx.name === context);
}

export function resolveService(svc: ServiceConfig, namespace: string): ResolvedService {
  return {
    name: svc.name,
    namespace,
    externalSecret: svc.external_secret || `${svc.name}-env`,
    deployment: svc.deployment || svc.name,
  };
}

export function findService(
  config: KickflipConfig,
  namespace: string,
  name: string,
): ResolvedService | undefined {
  const ns = config.namespaces.find((item) => item.name === namespace);
  const svc = ns?.services.find((item) => item.name === name);
  if (!ns || !svc) return undefined;
  return resolveService(svc, ns.name);
}

export async function writeSeedIfMissing(): Promise<boolean> {
  await ensureAppDirs();
  try {
    await access(configFilePath());
    return false;
  } catch {
    const body = stringify(seedDefaultConfig());
    await writeFile(configFilePath(), body, { mode: 0o600 });
    await chmod(configFilePath(), 0o600);
    return true;
  }
}

export async function loadConfig(): Promise<KickflipConfig> {
  await ensureAppDirs();
  let text: string;
  try {
    text = await readFile(configFilePath(), "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new Error(`Kickflip config not found at ${configFilePath()}`);
    }
    throw err;
  }
  return normalizeConfig(parse(text));
}

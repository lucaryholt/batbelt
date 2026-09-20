export interface AlternativeContext {
  name: string;
  context: string;
}

/** Kept for SQLite/YAML round-trip only; not used by the product. */
export interface Preset {
  name: string;
  services: string[];
}

export interface Service {
  id: string;
  name: string;
  tags: string[];
  service_name: string;
  remote_port: number;
  local_port: number;
  selected_by_default: boolean;
  context?: string;
  namespace?: string;
  max_retries?: number;
  sql_tap_port?: number;
  sql_tap_driver?: string;
  sql_tap_grpc_port?: number;
  sql_tap_http_port?: number;
}

export interface ProxyService {
  id: string;
  name: string;
  tags: string[];
  target_host: string;
  target_port: number;
  local_port: number;
  selected_by_default: boolean;
  proxy_pod_context: string;
  proxy_pod_namespace: string;
  max_retries?: number;
  sql_tap_port?: number;
  sql_tap_driver?: string;
  sql_tap_grpc_port?: number;
  sql_tap_http_port?: number;
}

export interface Config {
  cluster_context: string;
  cluster_name: string;
  namespace: string;
  max_retries: number;
  web_port: number;
  alternative_contexts: AlternativeContext[];
  presets: Preset[];
  services: Service[];
  proxy_pod_name: string;
  proxy_pod_image: string;
  proxy_pod_context: string;
  proxy_pod_namespace: string;
  proxy_services: ProxyService[];
}

export interface ConfigStore {
  load(): Config;
  save(cfg: Config): void;
  description(): string;
  writable: boolean;
  close?(): void;
}

export const DEFAULT_WEB_PORT = 8765;
export const DEFAULT_MAX_RETRIES = -1;
export const DEFAULT_PROXY_POD_NAME = "kubefwd-proxy";
export const DEFAULT_PROXY_POD_IMAGE = "alpine/socat:latest";
export const SQL_TAP_GRPC_START = 9091;

export function cloneConfig(cfg: Config): Config {
  return structuredClone(cfg);
}

export function serviceContext(svc: Service, globalContext: string): string {
  return svc.context || globalContext;
}

export function serviceNamespace(svc: Service, globalNamespace: string): string {
  return svc.namespace || globalNamespace;
}

export function serviceMaxRetries(svc: { max_retries?: number }, globalMaxRetries: number): number {
  return svc.max_retries !== undefined ? svc.max_retries : globalMaxRetries;
}

export function proxyGroupKey(ps: ProxyService): string {
  return `${ps.proxy_pod_context}/${ps.proxy_pod_namespace}`;
}

export function splitGroupKey(key: string): { context: string; namespace: string } {
  const idx = key.lastIndexOf("/");
  if (idx < 0) return { context: key, namespace: "" };
  return { context: key.slice(0, idx), namespace: key.slice(idx + 1) };
}

export function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "unnamed";
}

export function normalizeTags(tags: string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tags ?? []) {
    const trimmed = t.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

export function tagSetKey(tags: string[]): string {
  return [...tags].sort().join("\0");
}

export function deriveServiceId(name: string, tags: string[]): string {
  const base = slugify(name);
  const tagPart = [...tags].map(slugify).sort().join("-");
  return tagPart ? `${base}--${tagPart}` : base;
}

export function ensureEntryIdentity(entry: { id?: string; name: string; tags?: string[] }): void {
  entry.tags = normalizeTags(entry.tags);
  if (!entry.id) entry.id = deriveServiceId(entry.name, entry.tags);
}

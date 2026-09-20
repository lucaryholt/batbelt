import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  DEFAULT_MAX_RETRIES,
  DEFAULT_PROXY_POD_IMAGE,
  DEFAULT_PROXY_POD_NAME,
  DEFAULT_WEB_PORT,
  SQL_TAP_GRPC_START,
  ensureEntryIdentity,
  proxyGroupKey,
  tagSetKey,
  type Config,
  type ProxyService,
  type Service,
} from "./types.js";
import { rawConfigSchema } from "./schema.js";

function optionalInt(v: number | null | undefined): number | undefined {
  return v === null || v === undefined ? undefined : v;
}

function normalizeService(s: Service): Service {
  const out: Service = {
    id: s.id ?? "",
    name: s.name,
    tags: s.tags ?? [],
    service_name: s.service_name,
    remote_port: s.remote_port,
    local_port: s.local_port,
    selected_by_default: !!s.selected_by_default,
  };
  if (s.context) out.context = s.context;
  if (s.namespace) out.namespace = s.namespace;
  if (s.max_retries !== undefined) out.max_retries = s.max_retries;
  const sqlTapPort = optionalInt(s.sql_tap_port);
  if (sqlTapPort !== undefined) out.sql_tap_port = sqlTapPort;
  if (s.sql_tap_driver) out.sql_tap_driver = s.sql_tap_driver;
  const grpc = optionalInt(s.sql_tap_grpc_port);
  if (grpc !== undefined) out.sql_tap_grpc_port = grpc;
  const http = optionalInt(s.sql_tap_http_port);
  if (http !== undefined) out.sql_tap_http_port = http;
  return out;
}

function normalizeProxy(s: ProxyService): ProxyService {
  const out: ProxyService = {
    id: s.id ?? "",
    name: s.name,
    tags: s.tags ?? [],
    target_host: s.target_host,
    target_port: s.target_port,
    local_port: s.local_port,
    selected_by_default: !!s.selected_by_default,
    proxy_pod_context: s.proxy_pod_context ?? "",
    proxy_pod_namespace: s.proxy_pod_namespace ?? "",
  };
  if (s.max_retries !== undefined) out.max_retries = s.max_retries;
  const sqlTapPort = optionalInt(s.sql_tap_port);
  if (sqlTapPort !== undefined) out.sql_tap_port = sqlTapPort;
  if (s.sql_tap_driver) out.sql_tap_driver = s.sql_tap_driver;
  const grpc = optionalInt(s.sql_tap_grpc_port);
  if (grpc !== undefined) out.sql_tap_grpc_port = grpc;
  const http = optionalInt(s.sql_tap_http_port);
  if (http !== undefined) out.sql_tap_http_port = http;
  return out;
}

export function applyConfigDefaults(cfg: Config): void {
  if (cfg.max_retries === undefined || (cfg.max_retries as number | null) === null) {
    cfg.max_retries = DEFAULT_MAX_RETRIES;
  }
  if (!cfg.web_port) cfg.web_port = DEFAULT_WEB_PORT;
  if (!cfg.proxy_pod_name) cfg.proxy_pod_name = DEFAULT_PROXY_POD_NAME;
  if (!cfg.proxy_pod_image) cfg.proxy_pod_image = DEFAULT_PROXY_POD_IMAGE;
  if (!cfg.proxy_pod_context) cfg.proxy_pod_context = cfg.cluster_context;
  if (!cfg.proxy_pod_namespace) cfg.proxy_pod_namespace = cfg.namespace;
  if (!cfg.cluster_name) cfg.cluster_name = "";
  if (!cfg.alternative_contexts) cfg.alternative_contexts = [];
  if (!cfg.presets) cfg.presets = [];
  if (!cfg.services) cfg.services = [];
  if (!cfg.proxy_services) cfg.proxy_services = [];
  for (const s of cfg.services) ensureEntryIdentity(s);
  for (const ps of cfg.proxy_services) {
    ensureEntryIdentity(ps);
    if (!ps.proxy_pod_context) ps.proxy_pod_context = cfg.proxy_pod_context;
    if (!ps.proxy_pod_namespace) ps.proxy_pod_namespace = cfg.proxy_pod_namespace;
  }
}

function checkSqlTap(
  kind: string,
  i: number,
  name: string,
  localPort: number,
  sqlTapPort: number | undefined,
  sqlTapDriver: string | undefined,
  sqlTapGrpcPort: number | undefined,
  sqlTapHttpPort: number | undefined,
): void {
  if (sqlTapPort !== undefined) {
    if (sqlTapPort <= 0 || sqlTapPort > 65535) {
      throw new Error(`${kind} ${i} (${name}): invalid sql_tap_port`);
    }
    if (sqlTapPort === localPort) {
      throw new Error(`${kind} ${i} (${name}): sql_tap_port cannot be the same as local_port`);
    }
    if (!sqlTapDriver) {
      throw new Error(`${kind} ${i} (${name}): sql_tap_driver is required when sql_tap_port is set`);
    }
    if (sqlTapDriver !== "postgres" && sqlTapDriver !== "mysql") {
      throw new Error(`${kind} ${i} (${name}): sql_tap_driver must be 'postgres' or 'mysql'`);
    }
  }
  if (sqlTapGrpcPort !== undefined && (sqlTapGrpcPort <= 0 || sqlTapGrpcPort > 65535)) {
    throw new Error(`${kind} ${i} (${name}): invalid sql_tap_grpc_port`);
  }
  if (sqlTapHttpPort !== undefined) {
    if (sqlTapHttpPort <= 0 || sqlTapHttpPort > 65535) {
      throw new Error(`${kind} ${i} (${name}): invalid sql_tap_http_port`);
    }
    if (sqlTapHttpPort === localPort) {
      throw new Error(`${kind} ${i} (${name}): sql_tap_http_port cannot be the same as local_port`);
    }
    if (sqlTapPort !== undefined && sqlTapHttpPort === sqlTapPort) {
      throw new Error(`${kind} ${i} (${name}): sql_tap_http_port cannot be the same as sql_tap_port`);
    }
  }
}

export function validateConfig(cfg: Config, opts: { allowEmpty?: boolean } = {}): void {
  if (!opts.allowEmpty) {
    if (!cfg.cluster_context) throw new Error("cluster_context is required");
    if (cfg.services.length === 0 && cfg.proxy_services.length === 0) {
      throw new Error("at least one service or proxy service must be defined");
    }
  }
  if (!cfg.namespace) throw new Error("namespace is required");

  cfg.services.forEach((svc, i) => {
    if (!svc.name) throw new Error(`service ${i}: name is required`);
    if (!svc.service_name) throw new Error(`service ${i} (${svc.name}): service_name is required`);
    if (svc.remote_port <= 0 || svc.remote_port > 65535) {
      throw new Error(`service ${i} (${svc.name}): invalid remote_port`);
    }
    if (svc.local_port <= 0 || svc.local_port > 65535) {
      throw new Error(`service ${i} (${svc.name}): invalid local_port`);
    }
    checkSqlTap(
      "service",
      i,
      svc.name,
      svc.local_port,
      svc.sql_tap_port,
      svc.sql_tap_driver,
      svc.sql_tap_grpc_port,
      svc.sql_tap_http_port,
    );
  });

  cfg.proxy_services.forEach((ps, i) => {
    if (!ps.name) throw new Error(`proxy_service ${i}: name is required`);
    if (!ps.target_host) throw new Error(`proxy_service ${i} (${ps.name}): target_host is required`);
    if (ps.target_port <= 0 || ps.target_port > 65535) {
      throw new Error(`proxy_service ${i} (${ps.name}): invalid target_port`);
    }
    if (ps.local_port <= 0 || ps.local_port > 65535) {
      throw new Error(`proxy_service ${i} (${ps.name}): invalid local_port`);
    }
    if (!ps.proxy_pod_context) {
      throw new Error(`proxy_service ${i} (${ps.name}): proxy_pod_context is required`);
    }
    if (!ps.proxy_pod_namespace) {
      throw new Error(`proxy_service ${i} (${ps.name}): proxy_pod_namespace is required`);
    }
    checkSqlTap(
      "proxy_service",
      i,
      ps.name,
      ps.local_port,
      ps.sql_tap_port,
      ps.sql_tap_driver,
      ps.sql_tap_grpc_port,
      ps.sql_tap_http_port,
    );
  });

  assertUniqueIds("service", cfg.services);
  assertUniqueIds("proxy_service", cfg.proxy_services);
  assertUniqueNameTags("service", cfg.services);
  assertUniqueNameTags("proxy_service", cfg.proxy_services);
}

function assertUniqueIds(kind: string, entries: { id: string; name: string }[]): void {
  const seen = new Map<string, string>();
  for (const e of entries) {
    if (!e.id) throw new Error(`${kind} (${e.name}): id is required`);
    const prev = seen.get(e.id);
    if (prev) throw new Error(`${kind} id '${e.id}' is used by both '${prev}' and '${e.name}'`);
    seen.set(e.id, e.name);
  }
}

function assertUniqueNameTags(kind: string, entries: { name: string; tags: string[] }[]): void {
  const seen = new Map<string, true>();
  for (const e of entries) {
    const key = `${e.name}\n${tagSetKey(e.tags)}`;
    if (seen.has(key)) {
      const tagLabel = e.tags.length ? e.tags.slice().sort().join(", ") : "(no tags)";
      throw new Error(`${kind} '${e.name}' with tags [${tagLabel}] is defined more than once`);
    }
    seen.set(key, true);
  }
}

export function finalizeConfig(cfg: Config): void {
  const byNameTagsId = (a: { name: string; tags: string[]; id: string }, b: typeof a) => {
    const n = a.name.localeCompare(b.name);
    if (n !== 0) return n;
    const t = tagSetKey(a.tags).localeCompare(tagSetKey(b.tags));
    if (t !== 0) return t;
    return a.id.localeCompare(b.id);
  };
  cfg.services.sort(byNameTagsId);
  cfg.proxy_services.sort((a, b) => {
    const ki = proxyGroupKey(a);
    const kj = proxyGroupKey(b);
    if (ki !== kj) return ki.localeCompare(kj);
    return a.name.localeCompare(b.name);
  });

  let nextGrpcPort = SQL_TAP_GRPC_START;
  const assign = (item: { sql_tap_port?: number; sql_tap_grpc_port?: number }) => {
    if (item.sql_tap_port === undefined) return;
    if (item.sql_tap_grpc_port === undefined) {
      item.sql_tap_grpc_port = nextGrpcPort;
      nextGrpcPort++;
    } else if (item.sql_tap_grpc_port >= nextGrpcPort) {
      nextGrpcPort = item.sql_tap_grpc_port + 1;
    }
  };
  for (const s of cfg.services) assign(s);
  for (const s of cfg.proxy_services) assign(s);
}

function toConfig(raw: unknown): Config {
  const parsed = rawConfigSchema.parse(raw);
  const cfg: Config = {
    cluster_context: parsed.cluster_context,
    cluster_name: parsed.cluster_name,
    namespace: parsed.namespace,
    max_retries: parsed.max_retries ?? DEFAULT_MAX_RETRIES,
    web_port: parsed.web_port ?? 0,
    alternative_contexts: parsed.alternative_contexts,
    presets: parsed.presets,
    services: parsed.services.map((s) =>
      normalizeService({
        ...s,
        id: s.id || "",
        tags: s.tags ?? [],
        sql_tap_port: s.sql_tap_port ?? undefined,
        sql_tap_grpc_port: s.sql_tap_grpc_port ?? undefined,
        sql_tap_http_port: s.sql_tap_http_port ?? undefined,
      }),
    ),
    proxy_pod_name: parsed.proxy_pod_name,
    proxy_pod_image: parsed.proxy_pod_image,
    proxy_pod_context: parsed.proxy_pod_context,
    proxy_pod_namespace: parsed.proxy_pod_namespace,
    proxy_services: parsed.proxy_services.map((s) =>
      normalizeProxy({
        ...s,
        id: s.id || "",
        tags: s.tags ?? [],
        sql_tap_port: s.sql_tap_port ?? undefined,
        sql_tap_grpc_port: s.sql_tap_grpc_port ?? undefined,
        sql_tap_http_port: s.sql_tap_http_port ?? undefined,
      }),
    ),
  };
  // Preserve explicit max_retries: 0 (no retries). Only default when omitted.
  if (parsed.max_retries === undefined) {
    cfg.max_retries = DEFAULT_MAX_RETRIES;
  } else {
    cfg.max_retries = parsed.max_retries;
  }
  return cfg;
}

export function parseConfigObject(raw: unknown): Config {
  const cfg = toConfig(raw);
  applyConfigDefaults(cfg);
  validateConfig(cfg);
  finalizeConfig(cfg);
  return cfg;
}

export function parseConfigYaml(data: string): Config {
  let raw: unknown;
  try {
    raw = parseYaml(data) ?? {};
  } catch (err) {
    throw new Error(`failed to parse YAML: ${err instanceof Error ? err.message : String(err)}`);
  }
  return parseConfigObject(raw);
}

/** Normalize without finalize (used for SQLite save). */
export function prepareConfigForSave(cfg: Config, opts: { allowEmpty?: boolean } = {}): Config {
  const c = structuredClone(cfg);
  applyConfigDefaults(c);
  validateConfig(c, opts);
  return c;
}

export function emptyDefaultConfig(): Config {
  const cfg: Config = {
    cluster_context: "",
    cluster_name: "",
    namespace: "default",
    max_retries: DEFAULT_MAX_RETRIES,
    web_port: DEFAULT_WEB_PORT,
    alternative_contexts: [],
    presets: [],
    services: [],
    proxy_pod_name: DEFAULT_PROXY_POD_NAME,
    proxy_pod_image: DEFAULT_PROXY_POD_IMAGE,
    proxy_pod_context: "",
    proxy_pod_namespace: "default",
    proxy_services: [],
  };
  applyConfigDefaults(cfg);
  finalizeConfig(cfg);
  return cfg;
}

export function dumpConfigYaml(cfg: Config): string {
  const c = prepareConfigForSave(cfg);
  finalizeConfig(c);
  const doc: Record<string, unknown> = {
    cluster_context: c.cluster_context,
  };
  if (c.cluster_name) doc.cluster_name = c.cluster_name;
  doc.namespace = c.namespace;
  doc.max_retries = c.max_retries;
  doc.web_port = c.web_port;
  if (c.alternative_contexts.length) doc.alternative_contexts = c.alternative_contexts;
  if (c.presets.length) doc.presets = c.presets;
  doc.services = c.services;
  if (c.proxy_pod_name !== DEFAULT_PROXY_POD_NAME) doc.proxy_pod_name = c.proxy_pod_name;
  else doc.proxy_pod_name = c.proxy_pod_name;
  if (c.proxy_pod_image) doc.proxy_pod_image = c.proxy_pod_image;
  if (c.proxy_pod_context) doc.proxy_pod_context = c.proxy_pod_context;
  if (c.proxy_pod_namespace) doc.proxy_pod_namespace = c.proxy_pod_namespace;
  if (c.proxy_services.length) doc.proxy_services = c.proxy_services;
  return stringifyYaml(doc);
}

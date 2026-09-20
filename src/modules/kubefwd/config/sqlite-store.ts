import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import type { AlternativeContext, Config, ConfigStore, Preset, ProxyService, Service } from "./types.js";
import { applyConfigDefaults, emptyDefaultConfig, finalizeConfig, prepareConfigForSave, validateConfig } from "./parse.js";

export const SQLITE_SCHEMA_VERSION = 2;

export class SqliteEmptyError extends Error {
  constructor() {
    super("sqlite database has no configuration (use --import-yaml or import from the UI)");
    this.name = "SqliteEmptyError";
  }
}

const CORE_TABLES = [
  `CREATE TABLE IF NOT EXISTS settings (
			id INTEGER PRIMARY KEY CHECK (id = 1),
			cluster_context TEXT NOT NULL DEFAULT '',
			cluster_name TEXT NOT NULL DEFAULT '',
			namespace TEXT NOT NULL DEFAULT '',
			max_retries INTEGER NOT NULL DEFAULT -1,
			web_port INTEGER NOT NULL DEFAULT 8765,
			proxy_pod_name TEXT NOT NULL DEFAULT '',
			proxy_pod_image TEXT NOT NULL DEFAULT '',
			proxy_pod_context TEXT NOT NULL DEFAULT '',
			proxy_pod_namespace TEXT NOT NULL DEFAULT ''
		)`,
  `CREATE TABLE IF NOT EXISTS alternative_contexts (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			sort_order INTEGER NOT NULL,
			name TEXT NOT NULL,
			context TEXT NOT NULL,
			UNIQUE(name)
		)`,
  `CREATE TABLE IF NOT EXISTS presets (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			sort_order INTEGER NOT NULL,
			name TEXT NOT NULL UNIQUE
		)`,
  `CREATE TABLE IF NOT EXISTS preset_services (
			preset_id INTEGER NOT NULL REFERENCES presets(id) ON DELETE CASCADE,
			sort_order INTEGER NOT NULL,
			service_name TEXT NOT NULL,
			PRIMARY KEY (preset_id, sort_order)
		)`,
];

const SCHEMA_V1_SERVICES = [
  `CREATE TABLE IF NOT EXISTS services (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL UNIQUE,
			service_name TEXT NOT NULL,
			remote_port INTEGER NOT NULL,
			local_port INTEGER NOT NULL,
			selected_by_default INTEGER NOT NULL,
			context TEXT NOT NULL DEFAULT '',
			namespace TEXT NOT NULL DEFAULT '',
			max_retries INTEGER,
			sql_tap_port INTEGER,
			sql_tap_driver TEXT NOT NULL DEFAULT '',
			sql_tap_grpc_port INTEGER,
			sql_tap_http_port INTEGER
		)`,
  `CREATE TABLE IF NOT EXISTS proxy_services (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL UNIQUE,
			target_host TEXT NOT NULL,
			target_port INTEGER NOT NULL,
			local_port INTEGER NOT NULL,
			selected_by_default INTEGER NOT NULL,
			proxy_pod_context TEXT NOT NULL DEFAULT '',
			proxy_pod_namespace TEXT NOT NULL DEFAULT '',
			max_retries INTEGER,
			sql_tap_port INTEGER,
			sql_tap_driver TEXT NOT NULL DEFAULT '',
			sql_tap_grpc_port INTEGER,
			sql_tap_http_port INTEGER
		)`,
];

const SCHEMA_V2_SERVICES = [
  `CREATE TABLE IF NOT EXISTS services (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			uid TEXT NOT NULL UNIQUE,
			name TEXT NOT NULL,
			service_name TEXT NOT NULL,
			remote_port INTEGER NOT NULL,
			local_port INTEGER NOT NULL,
			selected_by_default INTEGER NOT NULL,
			context TEXT NOT NULL DEFAULT '',
			namespace TEXT NOT NULL DEFAULT '',
			max_retries INTEGER,
			sql_tap_port INTEGER,
			sql_tap_driver TEXT NOT NULL DEFAULT '',
			sql_tap_grpc_port INTEGER,
			sql_tap_http_port INTEGER
		)`,
  `CREATE TABLE IF NOT EXISTS proxy_services (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			uid TEXT NOT NULL UNIQUE,
			name TEXT NOT NULL,
			target_host TEXT NOT NULL,
			target_port INTEGER NOT NULL,
			local_port INTEGER NOT NULL,
			selected_by_default INTEGER NOT NULL,
			proxy_pod_context TEXT NOT NULL DEFAULT '',
			proxy_pod_namespace TEXT NOT NULL DEFAULT '',
			max_retries INTEGER,
			sql_tap_port INTEGER,
			sql_tap_driver TEXT NOT NULL DEFAULT '',
			sql_tap_grpc_port INTEGER,
			sql_tap_http_port INTEGER
		)`,
  `CREATE TABLE IF NOT EXISTS service_tags (
			service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
			tag TEXT NOT NULL,
			PRIMARY KEY (service_id, tag)
		)`,
  `CREATE TABLE IF NOT EXISTS proxy_service_tags (
			proxy_service_id INTEGER NOT NULL REFERENCES proxy_services(id) ON DELETE CASCADE,
			tag TEXT NOT NULL,
			PRIMARY KEY (proxy_service_id, tag)
		)`,
];

function optInt(v: number | undefined): number | null {
  return v === undefined ? null : v;
}

function fromInt(v: number | null): number | undefined {
  return v === null ? undefined : v;
}

export class SqliteConfigStore implements ConfigStore {
  readonly writable = true;
  private readonly db: Database.Database;

  constructor(readonly path: string) {
    const dir = dirname(path);
    if (dir && dir !== ".") mkdirSync(dir, { recursive: true });
    this.db = new Database(path);
    this.db.pragma("foreign_keys = ON");
    this.migrate();
  }

  description(): string {
    return `sqlite:${this.path}`;
  }

  close(): void {
    this.db.close();
  }

  private execAll(stmts: string[]): void {
    for (const sql of stmts) this.db.exec(sql);
  }

  private migrate(): void {
    const v = Number(this.db.pragma("user_version", { simple: true }));
    if (v >= SQLITE_SCHEMA_VERSION) return;

    const tx = this.db.transaction(() => {
      if (v === 0) {
        this.execAll(CORE_TABLES);
        this.execAll(SCHEMA_V2_SERVICES);
      } else if (v === 1) {
        this.migrateV1ToV2();
      }
      this.db.pragma(`user_version = ${SQLITE_SCHEMA_VERSION}`);
    });
    tx();
  }

  private migrateV1ToV2(): void {
    this.db.exec(`ALTER TABLE services RENAME TO services_v1`);
    this.db.exec(`ALTER TABLE proxy_services RENAME TO proxy_services_v1`);
    this.execAll(SCHEMA_V2_SERVICES);

    const oldSv = this.db
      .prepare(
        `SELECT name, service_name, remote_port, local_port, selected_by_default,
		context, namespace, max_retries, sql_tap_port, sql_tap_driver, sql_tap_grpc_port, sql_tap_http_port
		FROM services_v1`,
      )
      .all() as Record<string, unknown>[];
    const insSv = this.db.prepare(
      `INSERT INTO services (uid, name, service_name, remote_port, local_port, selected_by_default,
			context, namespace, max_retries, sql_tap_port, sql_tap_driver, sql_tap_grpc_port, sql_tap_http_port)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const row of oldSv) {
      insSv.run(
        String(row.name),
        String(row.name),
        String(row.service_name),
        row.remote_port,
        row.local_port,
        row.selected_by_default,
        row.context,
        row.namespace,
        row.max_retries,
        row.sql_tap_port,
        row.sql_tap_driver,
        row.sql_tap_grpc_port,
        row.sql_tap_http_port,
      );
    }

    const oldPx = this.db
      .prepare(
        `SELECT name, target_host, target_port, local_port, selected_by_default,
		proxy_pod_context, proxy_pod_namespace, max_retries, sql_tap_port, sql_tap_driver, sql_tap_grpc_port, sql_tap_http_port
		FROM proxy_services_v1`,
      )
      .all() as Record<string, unknown>[];
    const insPx = this.db.prepare(
      `INSERT INTO proxy_services (uid, name, target_host, target_port, local_port, selected_by_default,
			proxy_pod_context, proxy_pod_namespace, max_retries, sql_tap_port, sql_tap_driver, sql_tap_grpc_port, sql_tap_http_port)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const row of oldPx) {
      insPx.run(
        String(row.name),
        String(row.name),
        String(row.target_host),
        row.target_port,
        row.local_port,
        row.selected_by_default,
        row.proxy_pod_context,
        row.proxy_pod_namespace,
        row.max_retries,
        row.sql_tap_port,
        row.sql_tap_driver,
        row.sql_tap_grpc_port,
        row.sql_tap_http_port,
      );
    }

    this.db.exec(`DROP TABLE services_v1`);
    this.db.exec(`DROP TABLE proxy_services_v1`);
  }

  load(): Config {
    const count = this.db.prepare(`SELECT COUNT(*) AS n FROM settings WHERE id = 1`).get() as { n: number };
    if (count.n === 0) {
      const empty = emptyDefaultConfig();
      this.save(empty);
      return empty;
    }

    const settings = this.db
      .prepare(
        `SELECT cluster_context, cluster_name, namespace, max_retries, web_port,
		proxy_pod_name, proxy_pod_image, proxy_pod_context, proxy_pod_namespace FROM settings WHERE id = 1`,
      )
      .get() as {
      cluster_context: string;
      cluster_name: string;
      namespace: string;
      max_retries: number;
      web_port: number;
      proxy_pod_name: string;
      proxy_pod_image: string;
      proxy_pod_context: string;
      proxy_pod_namespace: string;
    };

    const alternative_contexts = this.db
      .prepare(`SELECT name, context FROM alternative_contexts ORDER BY sort_order, id`)
      .all() as AlternativeContext[];

    const presetRows = this.db.prepare(`SELECT id, name FROM presets ORDER BY sort_order, id`).all() as {
      id: number;
      name: string;
    }[];
    const presets: Preset[] = presetRows.map((pr) => {
      const names = this.db
        .prepare(`SELECT service_name FROM preset_services WHERE preset_id = ? ORDER BY sort_order`)
        .all(pr.id) as { service_name: string }[];
      return { name: pr.name, services: names.map((n) => n.service_name) };
    });

    const loadTags = (table: string, fk: string, rowId: number): string[] => {
      const rows = this.db.prepare(`SELECT tag FROM ${table} WHERE ${fk} = ? ORDER BY tag`).all(rowId) as {
        tag: string;
      }[];
      return rows.map((r) => r.tag);
    };

    const svcRows = this.db
      .prepare(
        `SELECT id, uid, name, service_name, remote_port, local_port, selected_by_default,
		context, namespace, max_retries, sql_tap_port, sql_tap_driver, sql_tap_grpc_port, sql_tap_http_port
		FROM services ORDER BY name, uid`,
      )
      .all() as Record<string, unknown>[];

    const services: Service[] = svcRows.map((row) => {
      const sv: Service = {
        id: String(row.uid),
        name: String(row.name),
        tags: loadTags("service_tags", "service_id", Number(row.id)),
        service_name: String(row.service_name),
        remote_port: Number(row.remote_port),
        local_port: Number(row.local_port),
        selected_by_default: Number(row.selected_by_default) !== 0,
      };
      if (row.context) sv.context = String(row.context);
      if (row.namespace) sv.namespace = String(row.namespace);
      const maxR = fromInt(row.max_retries as number | null);
      if (maxR !== undefined) sv.max_retries = maxR;
      const stp = fromInt(row.sql_tap_port as number | null);
      if (stp !== undefined) sv.sql_tap_port = stp;
      if (row.sql_tap_driver) sv.sql_tap_driver = String(row.sql_tap_driver);
      const stg = fromInt(row.sql_tap_grpc_port as number | null);
      if (stg !== undefined) sv.sql_tap_grpc_port = stg;
      const sth = fromInt(row.sql_tap_http_port as number | null);
      if (sth !== undefined) sv.sql_tap_http_port = sth;
      return sv;
    });

    const pxRows = this.db
      .prepare(
        `SELECT id, uid, name, target_host, target_port, local_port, selected_by_default,
		proxy_pod_context, proxy_pod_namespace, max_retries, sql_tap_port, sql_tap_driver, sql_tap_grpc_port, sql_tap_http_port
		FROM proxy_services ORDER BY proxy_pod_context, proxy_pod_namespace, name, uid`,
      )
      .all() as Record<string, unknown>[];

    const proxy_services: ProxyService[] = pxRows.map((row) => {
      const ps: ProxyService = {
        id: String(row.uid),
        name: String(row.name),
        tags: loadTags("proxy_service_tags", "proxy_service_id", Number(row.id)),
        target_host: String(row.target_host),
        target_port: Number(row.target_port),
        local_port: Number(row.local_port),
        selected_by_default: Number(row.selected_by_default) !== 0,
        proxy_pod_context: String(row.proxy_pod_context ?? ""),
        proxy_pod_namespace: String(row.proxy_pod_namespace ?? ""),
      };
      const maxR = fromInt(row.max_retries as number | null);
      if (maxR !== undefined) ps.max_retries = maxR;
      const stp = fromInt(row.sql_tap_port as number | null);
      if (stp !== undefined) ps.sql_tap_port = stp;
      if (row.sql_tap_driver) ps.sql_tap_driver = String(row.sql_tap_driver);
      const stg = fromInt(row.sql_tap_grpc_port as number | null);
      if (stg !== undefined) ps.sql_tap_grpc_port = stg;
      const sth = fromInt(row.sql_tap_http_port as number | null);
      if (sth !== undefined) ps.sql_tap_http_port = sth;
      return ps;
    });

    const cfg: Config = {
      cluster_context: settings.cluster_context,
      cluster_name: settings.cluster_name,
      namespace: settings.namespace,
      max_retries: settings.max_retries,
      web_port: settings.web_port,
      alternative_contexts,
      presets,
      services,
      proxy_pod_name: settings.proxy_pod_name,
      proxy_pod_image: settings.proxy_pod_image,
      proxy_pod_context: settings.proxy_pod_context,
      proxy_pod_namespace: settings.proxy_pod_namespace,
      proxy_services,
    };
    applyConfigDefaults(cfg);
    validateConfig(cfg, { allowEmpty: true });
    finalizeConfig(cfg);
    return cfg;
  }

  save(cfg: Config): void {
    const c = prepareConfigForSave(cfg, { allowEmpty: true });
    const tx = this.db.transaction(() => {
      this.db.exec(`DELETE FROM service_tags`);
      this.db.exec(`DELETE FROM proxy_service_tags`);
      this.db.exec(`DELETE FROM preset_services`);
      this.db.exec(`DELETE FROM presets`);
      this.db.exec(`DELETE FROM alternative_contexts`);
      this.db.exec(`DELETE FROM services`);
      this.db.exec(`DELETE FROM proxy_services`);

      this.db
        .prepare(
          `INSERT OR REPLACE INTO settings (id, cluster_context, cluster_name, namespace, max_retries, web_port,
		proxy_pod_name, proxy_pod_image, proxy_pod_context, proxy_pod_namespace) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          c.cluster_context,
          c.cluster_name,
          c.namespace,
          c.max_retries,
          c.web_port,
          c.proxy_pod_name,
          c.proxy_pod_image,
          c.proxy_pod_context,
          c.proxy_pod_namespace,
        );

      const insAc = this.db.prepare(`INSERT INTO alternative_contexts (sort_order, name, context) VALUES (?, ?, ?)`);
      c.alternative_contexts.forEach((ac, i) => insAc.run(i, ac.name, ac.context));

      const insPreset = this.db.prepare(`INSERT INTO presets (sort_order, name) VALUES (?, ?)`);
      const insPs = this.db.prepare(`INSERT INTO preset_services (preset_id, sort_order, service_name) VALUES (?, ?, ?)`);
      c.presets.forEach((pr, i) => {
        const info = insPreset.run(i, pr.name);
        const pid = Number(info.lastInsertRowid);
        pr.services.forEach((sn, j) => insPs.run(pid, j, sn));
      });

      const insSvc = this.db.prepare(
        `INSERT INTO services (uid, name, service_name, remote_port, local_port, selected_by_default,
			context, namespace, max_retries, sql_tap_port, sql_tap_driver, sql_tap_grpc_port, sql_tap_http_port)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const insTag = this.db.prepare(`INSERT INTO service_tags (service_id, tag) VALUES (?, ?)`);
      for (const sv of c.services) {
        const info = insSvc.run(
          sv.id,
          sv.name,
          sv.service_name,
          sv.remote_port,
          sv.local_port,
          sv.selected_by_default ? 1 : 0,
          sv.context ?? "",
          sv.namespace ?? "",
          optInt(sv.max_retries),
          optInt(sv.sql_tap_port),
          (sv.sql_tap_driver ?? "").trim(),
          optInt(sv.sql_tap_grpc_port),
          optInt(sv.sql_tap_http_port),
        );
        const rowId = Number(info.lastInsertRowid);
        for (const tag of sv.tags ?? []) insTag.run(rowId, tag);
      }

      const insPx = this.db.prepare(
        `INSERT INTO proxy_services (uid, name, target_host, target_port, local_port, selected_by_default,
			proxy_pod_context, proxy_pod_namespace, max_retries, sql_tap_port, sql_tap_driver, sql_tap_grpc_port, sql_tap_http_port)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const insPxTag = this.db.prepare(`INSERT INTO proxy_service_tags (proxy_service_id, tag) VALUES (?, ?)`);
      for (const ps of c.proxy_services) {
        const info = insPx.run(
          ps.id,
          ps.name,
          ps.target_host,
          ps.target_port,
          ps.local_port,
          ps.selected_by_default ? 1 : 0,
          ps.proxy_pod_context,
          ps.proxy_pod_namespace,
          optInt(ps.max_retries),
          optInt(ps.sql_tap_port),
          (ps.sql_tap_driver ?? "").trim(),
          optInt(ps.sql_tap_grpc_port),
          optInt(ps.sql_tap_http_port),
        );
        const rowId = Number(info.lastInsertRowid);
        for (const tag of ps.tags ?? []) insPxTag.run(rowId, tag);
      }
    });
    tx();
  }
}

/** Test helper: create a v1-shaped database so migration can be exercised. */
export function createLegacyV1Database(path: string): void {
  const dir = dirname(path);
  if (dir && dir !== ".") mkdirSync(dir, { recursive: true });
  const db = new Database(path);
  db.pragma("foreign_keys = ON");
  for (const sql of CORE_TABLES) db.exec(sql);
  for (const sql of SCHEMA_V1_SERVICES) db.exec(sql);
  db.pragma("user_version = 1");
  db.close();
}

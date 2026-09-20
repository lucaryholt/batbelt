import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import {
  createLegacyV1Database,
  dumpConfigYaml,
  FileConfigStore,
  parseConfigYaml,
  SqliteConfigStore,
} from "./index.js";
import { backoffSeconds, shouldRetry } from "../forwards/retry.js";

const MINIMAL = `
cluster_context: ctx1
namespace: default
services:
  - name: A
    service_name: svc-a
    remote_port: 80
    local_port: 8080
    selected_by_default: false
`;

const WITH_PRESETS = `
cluster_context: ctx1
namespace: default
max_retries: 0
presets:
  - name: Backend
    services:
      - A
services:
  - name: A
    service_name: svc-a
    remote_port: 80
    local_port: 8080
    selected_by_default: true
    sql_tap_port: 5433
    sql_tap_driver: postgres
proxy_services:
  - name: CloudSQL
    target_host: 10.1.2.3
    target_port: 5432
    local_port: 5432
    selected_by_default: false
    proxy_pod_context: ctx1
    proxy_pod_namespace: default
`;

describe("parseConfigYaml", () => {
  it("parses a minimal config", () => {
    const cfg = parseConfigYaml(MINIMAL);
    expect(cfg.cluster_context).toBe("ctx1");
    expect(cfg.namespace).toBe("default");
    expect(cfg.web_port).toBe(8765);
    expect(cfg.max_retries).toBe(-1);
    expect(cfg.services).toHaveLength(1);
    expect(cfg.services[0].name).toBe("A");
    expect(cfg.proxy_pod_name).toBe("kubefwd-proxy");
  });

  it("keeps global max_retries 0 as no retries", () => {
    const cfg = parseConfigYaml(WITH_PRESETS);
    expect(cfg.max_retries).toBe(0);
  });

  it("round-trips presets for storage but they are unused by the product", () => {
    const cfg = parseConfigYaml(WITH_PRESETS);
    expect(cfg.presets).toEqual([{ name: "Backend", services: ["A"] }]);
  });

  it("auto-assigns sql_tap_grpc_port from 9091", () => {
    const cfg = parseConfigYaml(WITH_PRESETS);
    expect(cfg.services[0].sql_tap_grpc_port).toBe(9091);
  });

  it("rejects missing cluster_context", () => {
    expect(() => parseConfigYaml("namespace: default\nservices: []\n")).toThrow(/cluster_context/);
  });

  it("rejects empty services and proxy_services", () => {
    expect(() => parseConfigYaml("cluster_context: c\nnamespace: n\n")).toThrow(/at least one/);
  });

  it("requires sql_tap_driver when sql_tap_port is set", () => {
    const yaml = `
cluster_context: c
namespace: n
services:
  - name: db
    service_name: postgres
    remote_port: 5432
    local_port: 5432
    selected_by_default: false
    sql_tap_port: 5433
`;
    expect(() => parseConfigYaml(yaml)).toThrow(/sql_tap_driver/);
  });
});

describe("service identity and tags", () => {
  it("assigns a stable derived id when omitted", () => {
    const cfg = parseConfigYaml(`
cluster_context: c
namespace: n
services:
  - name: API Server
    service_name: api
    remote_port: 80
    local_port: 8080
    selected_by_default: false
`);
    expect(cfg.services[0].id).toBe("api-server");
    expect(cfg.services[0].tags).toEqual([]);
    const again = parseConfigYaml(dumpConfigYaml(cfg));
    expect(again.services[0].id).toBe("api-server");
  });

  it("derives id from name and sorted slugged tags", () => {
    const cfg = parseConfigYaml(`
cluster_context: c
namespace: n
services:
  - name: API Server
    tags: [dev]
    service_name: api
    remote_port: 80
    local_port: 8080
    selected_by_default: false
`);
    expect(cfg.services[0].id).toBe("api-server--dev");
    expect(cfg.services[0].tags).toEqual(["dev"]);
  });

  it("coerces a single tag string to a list", () => {
    const cfg = parseConfigYaml(`
cluster_context: c
namespace: n
services:
  - name: API
    tags: prod
    service_name: api
    remote_port: 80
    local_port: 8080
    selected_by_default: false
`);
    expect(cfg.services[0].tags).toEqual(["prod"]);
    expect(cfg.services[0].id).toBe("api--prod");
  });

  it("allows the same display name with different tag sets", () => {
    const cfg = parseConfigYaml(`
cluster_context: c
namespace: n
services:
  - name: API
    tags: [dev]
    service_name: api
    remote_port: 80
    local_port: 8080
    selected_by_default: false
  - name: API
    tags: [prod]
    service_name: api
    remote_port: 80
    local_port: 8081
    selected_by_default: false
`);
    expect(cfg.services).toHaveLength(2);
    expect(cfg.services.map((s) => s.id).sort()).toEqual(["api--dev", "api--prod"]);
  });

  it("rejects the same name and tags even when ids differ", () => {
    const yaml = `
cluster_context: c
namespace: n
services:
  - name: API
    id: api-dev-1
    tags: [dev]
    service_name: api
    remote_port: 80
    local_port: 8080
    selected_by_default: false
  - name: API
    id: api-dev-2
    tags: [dev]
    service_name: api
    remote_port: 80
    local_port: 8081
    selected_by_default: false
`;
    expect(() => parseConfigYaml(yaml)).toThrow(/API.*dev/);
  });

  it("rejects omitted ids that collide after derivation", () => {
    const yaml = `
cluster_context: c
namespace: n
services:
  - name: API
    tags: [dev]
    service_name: api
    remote_port: 80
    local_port: 8080
    selected_by_default: false
  - name: API
    tags: [dev]
    service_name: api
    remote_port: 80
    local_port: 8081
    selected_by_default: false
`;
    expect(() => parseConfigYaml(yaml)).toThrow(/api--dev/);
  });

  it("rejects colliding generated and explicit ids", () => {
    const yaml = `
cluster_context: c
namespace: n
services:
  - name: Other
    id: api-server
    service_name: other
    remote_port: 80
    local_port: 8080
    selected_by_default: false
  - name: API Server
    service_name: api
    remote_port: 80
    local_port: 8081
    selected_by_default: false
`;
    expect(() => parseConfigYaml(yaml)).toThrow(/api-server/);
  });

  it("keeps an explicit id", () => {
    const cfg = parseConfigYaml(`
cluster_context: c
namespace: n
services:
  - name: API Server
    id: custom-api
    tags: [dev]
    service_name: api
    remote_port: 80
    local_port: 8080
    selected_by_default: false
`);
    expect(cfg.services[0].id).toBe("custom-api");
  });
});

describe("retry helpers", () => {
  it("backs off exponentially and caps at 60s", () => {
    expect(backoffSeconds(0)).toBe(1);
    expect(backoffSeconds(1)).toBe(2);
    expect(backoffSeconds(2)).toBe(4);
    expect(backoffSeconds(10)).toBe(60);
  });

  it("honors max_retries 0 as disabled", () => {
    expect(shouldRetry(false, 0, 0)).toBe(false);
  });

  it("retries infinitely when max_retries is -1", () => {
    expect(shouldRetry(false, 99, -1)).toBe(true);
  });

  it("does not retry after manual stop", () => {
    expect(shouldRetry(true, 0, -1)).toBe(false);
  });
});

describe("FileConfigStore", () => {
  it("loads and saves YAML atomically", () => {
    const dir = mkdtempSync(join(tmpdir(), "kubefwd-"));
    const path = join(dir, "cfg.yaml");
    writeFileSync(path, MINIMAL);
    const store = new FileConfigStore(path);
    expect(store.writable).toBe(false);
    const cfg = store.load();
    cfg.cluster_name = "Prod";
    store.save(cfg);
    const reloaded = store.load();
    expect(reloaded.cluster_name).toBe("Prod");
    expect(reloaded.services[0].name).toBe("A");
  });
});

describe("SqliteConfigStore", () => {
  it("initializes a writable default config on empty database", () => {
    const dir = mkdtempSync(join(tmpdir(), "kubefwd-"));
    const path = join(dir, "empty.db");
    const store = new SqliteConfigStore(path);
    const loaded = store.load();
    expect(loaded.cluster_context).toBe("");
    expect(loaded.namespace).toBe("default");
    expect(loaded.services).toEqual([]);
    expect(loaded.proxy_services).toEqual([]);
    expect(store.writable).toBe(true);
    loaded.services.push({
      id: "api",
      name: "API",
      tags: [],
      service_name: "api",
      remote_port: 80,
      local_port: 8080,
      selected_by_default: false,
    });
    store.save(loaded);
    const again = store.load();
    expect(again.services).toHaveLength(1);
    expect(again.services[0].name).toBe("API");
    store.close();
  });

  it("round-trips config including presets tables", () => {
    const dir = mkdtempSync(join(tmpdir(), "kubefwd-"));
    const path = join(dir, "cfg.db");
    const store = new SqliteConfigStore(path);
    expect(store.writable).toBe(true);
    const cfg = parseConfigYaml(WITH_PRESETS);
    store.save(cfg);
    const loaded = store.load();
    expect(loaded.cluster_context).toBe("ctx1");
    expect(loaded.max_retries).toBe(0);
    expect(loaded.presets).toEqual([{ name: "Backend", services: ["A"] }]);
    expect(loaded.services[0].sql_tap_port).toBe(5433);
    expect(loaded.proxy_services[0].target_host).toBe("10.1.2.3");
    store.description().startsWith("sqlite:");
    store.close();
  });

  it("preserves presets on subsequent save of services", () => {
    const dir = mkdtempSync(join(tmpdir(), "kubefwd-"));
    const path = join(dir, "cfg.db");
    const store = new SqliteConfigStore(path);
    const cfg = parseConfigYaml(WITH_PRESETS);
    store.save(cfg);
    const loaded = store.load();
    loaded.services.push({
      name: "B",
      service_name: "svc-b",
      remote_port: 81,
      local_port: 8081,
      selected_by_default: false,
    });
    store.save(loaded);
    const again = store.load();
    expect(again.presets[0].name).toBe("Backend");
    expect(again.services.map((s) => s.name).sort()).toEqual(["A", "B"]);
    expect(again.services.find((s) => s.name === "B")?.id).toBe("b");
    store.close();
  });

  it("migrates a v1 database and round-trips tags", () => {
    const dir = mkdtempSync(join(tmpdir(), "kubefwd-"));
    const path = join(dir, "legacy.db");
    createLegacyV1Database(path);
    const db = new Database(path);
    db.prepare(`INSERT INTO settings (id, cluster_context, namespace) VALUES (1, 'ctx', 'ns')`).run();
    db.prepare(
      `INSERT INTO services (name, service_name, remote_port, local_port, selected_by_default)
			VALUES ('API', 'api', 80, 8080, 0)`,
    ).run();
    db.prepare(
      `INSERT INTO proxy_services (name, target_host, target_port, local_port, selected_by_default, proxy_pod_context, proxy_pod_namespace)
			VALUES ('CloudSQL', '10.1.2.3', 5432, 5432, 0, 'ctx', 'ns')`,
    ).run();
    db.close();

    const store = new SqliteConfigStore(path);
    const loaded = store.load();
    expect(loaded.services[0].id).toBe("API");
    expect(loaded.services[0].name).toBe("API");
    expect(loaded.services[0].tags).toEqual([]);
    expect(loaded.proxy_services[0].id).toBe("CloudSQL");
    expect(loaded.proxy_services[0].tags).toEqual([]);

    loaded.services[0].tags = ["dev", "eu"];
    loaded.proxy_services[0].tags = ["prod"];
    store.save(loaded);
    const again = store.load();
    expect(again.services[0].id).toBe("API");
    expect(again.services[0].tags).toEqual(["dev", "eu"]);
    expect(again.proxy_services[0].id).toBe("CloudSQL");
    expect(again.proxy_services[0].tags).toEqual(["prod"]);
    store.close();
  });
});

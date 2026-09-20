import { readFileSync } from "node:fs";
import { Hono } from "hono";
import type { BatbeltModule, ModuleContext } from "../types.js";
import { App } from "./app.js";
import { parseConfigYaml, SqliteConfigStore } from "./config/index.js";
import { setDebugMode } from "./debug.js";
import { checkKubectlAvailable, validateContext } from "./kubectl.js";
import { createApp } from "./server/index.js";
import { checkSqlTapdAvailable, configNeedsSqlTap } from "./sqltap/manager.js";

class KubefwdModule implements BatbeltModule {
  readonly id = "kubefwd";
  readonly title = "Kubefwd";
  readonly pages = [
    { id: "services", label: "Services", path: "services" },
    { id: "proxy", label: "Proxy", path: "proxy" },
    { id: "ports", label: "Port Checker", path: "ports" },
    { id: "explore", label: "Explore", path: "explore" },
  ];

  private app: App | null = null;
  private sqlite: SqliteConfigStore | undefined;
  private readonly routes = new Hono();

  createRoutes(): Hono {
    return this.routes;
  }

  async start(ctx: ModuleContext): Promise<void> {
    setDebugMode(ctx.debug);

    try {
      await checkKubectlAvailable();
    } catch (err) {
      process.stderr.write(`Warning: ${err instanceof Error ? err.message : String(err)}\n`);
    }

    this.sqlite = new SqliteConfigStore(ctx.dbPath);
    if (ctx.importYaml) {
      const data = readFileSync(ctx.importYaml, "utf8");
      this.sqlite.save(parseConfigYaml(data));
    }

    const config = this.sqlite.load();
    if (config.cluster_context) {
      try {
        await validateContext(config.cluster_context);
      } catch (err) {
        process.stderr.write(`Warning: ${err instanceof Error ? err.message : String(err)}\n`);
        process.stderr.write("Kubefwd will start; start/stop needs a valid cluster context.\n");
      }
    }

    if (configNeedsSqlTap(config.services, config.proxy_services)) {
      try {
        await checkSqlTapdAvailable();
      } catch (err) {
        process.stderr.write(`Warning: ${err instanceof Error ? err.message : String(err)}\n`);
        process.stderr.write("sql-tap features will not work. Install sql-tap from https://github.com/mickamy/sql-tap\n");
      }
    }

    this.app = new App(config, this.sqlite);
    if (ctx.startDefaults) this.app.startDefaults();
    if (ctx.startDefaultProxies) void this.app.startDefaultProxies();

    const api = createApp(this.app);
    this.routes.route("/", api);
  }

  async stop(): Promise<void> {
    await this.app?.stopAll();
    this.sqlite?.close();
    this.app = null;
  }
}

export const kubefwdModule: BatbeltModule = new KubefwdModule();

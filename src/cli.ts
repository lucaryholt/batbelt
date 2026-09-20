#!/usr/bin/env node
import { Command } from "commander";
import { serve } from "@hono/node-server";
import open from "open";
import { DEFAULT_PORT, defaultDbPath, ensureConfigDir } from "./paths.js";
import { getModules, registerModule } from "./modules/registry.js";
import type { ModuleContext } from "./modules/types.js";
import { createHostApp } from "./server/index.js";
import { kubefwdModule } from "./modules/kubefwd/index.js";
import { steamerModule } from "./modules/steamer/index.js";

async function main(): Promise<void> {
  const program = new Command();
  program
    .name("batbelt")
    .description("Modular localhost toolbox")
    .option("--port <number>", "HTTP port", String(DEFAULT_PORT))
    .option("--db <path>", "Kubefwd SQLite database path", defaultDbPath())
    .option("--import-yaml <path>", "Import a YAML file into the Kubefwd SQLite database, then start")
    .option("--debug", "Enable Kubefwd debug output", false)
    .option("--open", "Open the UI in a browser", false)
    .option("--default", "Auto-start Kubefwd services marked with selected_by_default", false)
    .option("--default-proxy", "Auto-start Kubefwd proxy services marked with selected_by_default", false)
    .parse();

  const opts = program.opts<{
    port: string;
    db: string;
    importYaml?: string;
    debug: boolean;
    open: boolean;
    default: boolean;
    defaultProxy: boolean;
  }>();

  const port = Number(process.env.PORT ?? opts.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    process.stderr.write("Error: --port must be an integer between 1 and 65535\n");
    process.exit(1);
  }

  const ctx: ModuleContext = {
    configDir: ensureConfigDir(),
    port,
    dbPath: opts.db,
    importYaml: opts.importYaml,
    debug: !!opts.debug,
    open: !!opts.open,
    startDefaults: !!opts.default,
    startDefaultProxies: !!opts.defaultProxy,
  };

  registerModule(kubefwdModule);
  registerModule(steamerModule);

  for (const mod of getModules()) {
    await mod.start?.(ctx);
  }

  const hono = createHostApp();
  const server = serve({ fetch: hono.fetch, port, hostname: "127.0.0.1" });
  const url = `http://127.0.0.1:${port}`;
  process.stdout.write(`batbelt running at ${url}\n`);

  if (ctx.open) {
    try {
      await open(url);
    } catch {
      process.stdout.write(`Open ${url} in your browser\n`);
    }
  }

  const shutdown = async () => {
    process.stderr.write("\nShutting down…\n");
    for (const mod of [...getModules()].reverse()) {
      await mod.stop?.();
    }
    server.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});

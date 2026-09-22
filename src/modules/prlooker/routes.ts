import { Hono } from "hono";
import { openInCode } from "../../open-in-code.js";
import { loadConfig, writeEmptyIfMissing } from "./config.js";
import { fetchInbox, ghHealth, runGh, type RunGh } from "./gh.js";
import { configFilePath } from "./paths.js";
import type { ConfigResponse, HealthResponse } from "./types.js";

export interface PrlookerDeps {
  runGh?: RunGh;
}

export function createRoutes(deps: PrlookerDeps = {}): Hono {
  const exec = deps.runGh ?? runGh;
  const app = new Hono();

  app.get("/health", async (c) => {
    const body: HealthResponse = await ghHealth(exec);
    return c.json(body);
  });

  app.get("/config", async (c) => {
    try {
      const config = await loadConfig();
      const body: ConfigResponse = { pollSeconds: config.pollSeconds, teams: config.teams };
      return c.json(body);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  });

  app.post("/config/open", async (c) => {
    try {
      await writeEmptyIfMissing();
      return c.json(await openInCode(configFilePath()));
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  app.post("/config/reload", async (c) => {
    try {
      const config = await loadConfig();
      const body: ConfigResponse = { pollSeconds: config.pollSeconds, teams: config.teams };
      return c.json(body);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  });

  app.get("/inbox", async (c) => {
    try {
      const config = await loadConfig();
      return c.json(await fetchInbox(config, exec));
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  return app;
}

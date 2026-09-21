import { access } from "node:fs/promises";
import { Hono } from "hono";
import { openInCode } from "../../open-in-code.js";
import { emptyConfig, loadConfig, saveConfig } from "./config.js";
import { configFilePath } from "./paths.js";
import type { HomepageConfig } from "./types.js";

export function createRoutes(): Hono {
  const app = new Hono();

  app.get("/config", async (c) => {
    try {
      return c.json(await loadConfig());
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  });

  app.put("/config", async (c) => {
    let body: HomepageConfig;
    try {
      body = (await c.req.json()) as HomepageConfig;
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    try {
      return c.json(await saveConfig(body));
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  });

  app.post("/config/open", async (c) => {
    try {
      await loadConfig();
      try {
        await access(configFilePath());
      } catch {
        await saveConfig(emptyConfig());
      }
      return c.json(await openInCode(configFilePath()));
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  return app;
}

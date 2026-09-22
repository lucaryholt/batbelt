import { access, stat } from "node:fs/promises";
import { Hono } from "hono";
import { detectTools, lookPath, openDirectory, type OpenResult } from "../../open-local.js";
import { openInCode } from "../../open-in-code.js";
import { emptyConfig, expandShortcutPath, findShortcut, loadConfig, saveConfig } from "./config.js";
import { configFilePath } from "./paths.js";
import type { DirTool, HomepageConfig, TerminalConfig } from "./types.js";
import { isDirShortcut } from "./types.js";

export interface HomepageDeps {
  openDirectory?: (
    input: { path: string; tool: DirTool; terminal: TerminalConfig },
  ) => Promise<OpenResult>;
  lookPath?: (bin: string) => Promise<boolean>;
}

export function createRoutes(deps: HomepageDeps = {}): Hono {
  const app = new Hono();
  const open = deps.openDirectory ?? openDirectory;
  const which = deps.lookPath ?? lookPath;

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

  app.get("/tools", async (c) => {
    return c.json(await detectTools(which));
  });

  app.post("/open", async (c) => {
    let body: { id?: unknown };
    try {
      body = (await c.req.json()) as { id?: unknown };
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    const id = String(body.id ?? "").trim();
    if (!id) return c.json({ error: "id is required" }, 400);

    let config: HomepageConfig;
    try {
      config = await loadConfig();
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }

    const hit = findShortcut(config, id);
    if (!hit) return c.json({ error: `Unknown shortcut: ${id}` }, 400);
    if (!isDirShortcut(hit.shortcut)) {
      return c.json({ error: "Shortcut is not a directory shortcut" }, 400);
    }

    const absDir = expandShortcutPath(hit.shortcut.path);
    try {
      const info = await stat(absDir);
      if (!info.isDirectory()) {
        return c.json({ error: `Not a directory: ${absDir}` }, 400);
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        return c.json({ error: `Directory not found: ${absDir}` }, 400);
      }
      return c.json({ error: (err as Error).message }, 400);
    }

    try {
      return c.json(
        await open({
          path: absDir,
          tool: hit.shortcut.tool,
          terminal: config.terminal,
        }),
      );
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  return app;
}

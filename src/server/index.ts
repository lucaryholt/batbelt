import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { getModules } from "../modules/registry.js";
import { toDescriptor } from "../modules/types.js";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".map": "application/json",
  ".ico": "image/x-icon",
};

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function webRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "dist", "web");
}

export function createHostApp(): Hono {
  const app = new Hono();

  app.get("/api/health", (c) => {
    return c.json({ ok: true, host: "batbelt" });
  });

  app.get("/api/modules", (c) => {
    return c.json({ modules: getModules().map(toDescriptor) });
  });

  for (const mod of getModules()) {
    app.route(`/api/${mod.id}`, mod.createRoutes());
  }

  if (process.env.DEV !== "1") {
    const root = webRoot();
    if (existsSync(root)) {
      app.get("/*", async (c) => {
        const urlPath = decodeURIComponent(new URL(c.req.url).pathname);
        const safe = urlPath.replace(/^\/+/, "").replace(/\.\./g, "");
        const candidates = [
          join(root, safe),
          join(root, safe, "index.html"),
          join(root, "index.html"),
        ];
        for (const file of candidates) {
          if (!file.startsWith(root) || !isFile(file)) continue;
          const data = await readFile(file);
          const type = MIME[extname(file)] ?? "application/octet-stream";
          return c.body(data, 200, { "content-type": type });
        }
        return c.text("Not found", 404);
      });
    }
  }

  return app;
}

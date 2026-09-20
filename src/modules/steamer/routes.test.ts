import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRoutes } from "./routes.js";

describe("steamer write confirm", () => {
  const prev = process.env.XDG_CONFIG_HOME;
  let dir: string;

  afterEach(() => {
    if (prev === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = prev;
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("rejects secret writes without confirm", async () => {
    dir = mkdtempSync(join(tmpdir(), "batbelt-steamer-"));
    process.env.XDG_CONFIG_HOME = dir;
    const app = createRoutes();
    const res = await app.request("/secrets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mount: "secret",
        path: "apps/demo",
        values: { dev: { password: "x" } },
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toMatch(/confirm/i);
  });
});

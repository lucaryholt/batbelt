import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRoutes } from "./routes.js";

describe("steamer secret writes", () => {
  const prev = process.env.XDG_CONFIG_HOME;
  let dir: string;

  afterEach(() => {
    if (prev === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = prev;
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("rejects secret writes even when confirmed", async () => {
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
        confirm: true,
      }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe(
      "Secret writes are disabled. Edit this path in the OpenBao UI.",
    );
  });
});

import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

  function configure() {
    dir = mkdtempSync(join(tmpdir(), "batbelt-steamer-"));
    process.env.XDG_CONFIG_HOME = dir;
    const configDir = join(dir, "batbelt", "steamer");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "config.yaml"),
      "environments:\n  - name: dev\n    addr: https://bao.example.com\n    kvMount: secret\n",
    );
  }

  it("previews exact commands without executing them and rejects the batch", async () => {
    configure();
    const app = createRoutes();
    const previewRes = await app.request("/secrets/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mount: "secret",
        path: "apps/demo",
        values: { dev: { password: "x" } },
      }),
    });
    expect(previewRes.status).toBe(200);
    const preview = (await previewRes.json()) as {
      approvalId: string;
      commands: Array<{ environment: string; command: string }>;
    };
    expect(preview.commands[0].environment).toBe("dev");
    expect(preview.commands[0].command).toMatch(
      /^bao kv put -mount=secret -format=json apps\/demo @\/.*\/payload\.json$/,
    );

    const reject = await app.request("/secrets/reject", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ approvalId: preview.approvalId }),
    });
    expect(reject.status).toBe(200);

    const replay = await app.request("/secrets/approve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ approvalId: preview.approvalId }),
    });
    expect(replay.status).toBe(404);
  });

  it("rejects unknown environments before staging", async () => {
    configure();
    const app = createRoutes();
    const res = await app.request("/secrets/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mount: "secret",
        path: "apps/demo",
        values: { prod: { password: "x" } },
      }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Unknown environment: prod" });
  });
});

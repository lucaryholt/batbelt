import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeSeedIfMissing } from "./config.js";
import { annotateExternalSecretArgs, rolloutRestartArgs } from "./kubectl.js";
import { createRoutes } from "./routes.js";
import type { KubectlResult } from "./types.js";

async function readSse(res: Response): Promise<Record<string, unknown>[]> {
  const text = await res.text();
  const events: Record<string, unknown>[] = [];
  for (const block of text.split("\n\n")) {
    for (const line of block.split("\n")) {
      if (!line.startsWith("data:")) continue;
      events.push(JSON.parse(line.slice(5).trim()) as Record<string, unknown>);
    }
  }
  return events;
}

describe("kickflip routes", () => {
  const prev = process.env.XDG_CONFIG_HOME;
  let dir: string;

  afterEach(() => {
    if (prev === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = prev;
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  async function seededApp(
    runKubectl: (args: string[], onLine?: (line: string) => void | Promise<void>) => Promise<KubectlResult> = async () => ({
      ok: true,
      code: 0,
      stdout: "",
      stderr: "",
    }),
    now = () => 1700000000,
  ) {
    dir = mkdtempSync(join(tmpdir(), "batbelt-kickflip-"));
    process.env.XDG_CONFIG_HOME = dir;
    await writeSeedIfMissing();
    return createRoutes({ runKubectl, now });
  }

  const runBody = {
    context: "gke_gowish-devx_europe-west1_api-eu",
    mode: "restart" as const,
    services: [{ namespace: "personalization-service", name: "brands" }],
    confirm: true,
  };

  it("rejects runs without confirm", async () => {
    const app = await seededApp();
    const res = await app.request("/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...runBody, confirm: false }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toMatch(/confirm/i);
  });

  it("rejects unknown services before kubectl", async () => {
    const calls: string[][] = [];
    const app = await seededApp(async (args) => {
      calls.push(args);
      return { ok: true, code: 0, stdout: "", stderr: "" };
    });
    const res = await app.request("/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...runBody,
        services: [{ namespace: "personalization-service", name: "nope" }],
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toMatch(/unknown service/i);
    expect(calls).toEqual([]);
  });

  it("rejects a second run while one is active", async () => {
    let release!: (result: KubectlResult) => void;
    const gate = new Promise<KubectlResult>((resolve) => {
      release = resolve;
    });
    let started = 0;
    const app = await seededApp(async () => {
      started += 1;
      return gate;
    });
    const first = await app.request("/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(runBody),
    });
    expect(first.status).toBe(200);
    const second = await app.request("/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(runBody),
    });
    expect(second.status).toBe(409);
    expect(started).toBe(0);
    const finished = first.text();
    release({ ok: true, code: 0, stdout: "", stderr: "" });
    await finished;
    expect(started).toBeGreaterThan(0);
  });

  it("builds annotate then restart argv for secrets-restart", async () => {
    const calls: string[][] = [];
    const app = await seededApp(async (args) => {
      calls.push(args);
      return { ok: true, code: 0, stdout: "ok\n", stderr: "" };
    });
    const res = await app.request("/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...runBody, mode: "secrets-restart" }),
    });
    expect(res.status).toBe(200);
    const events = await readSse(res);
    expect(events.some((event) => event.type === "done")).toBe(true);
    expect(calls).toEqual([
      annotateExternalSecretArgs({
        context: runBody.context,
        namespace: "personalization-service",
        externalSecret: "brands-env",
        forceSync: "1700000000",
      }),
      rolloutRestartArgs({
        context: runBody.context,
        namespace: "personalization-service",
        deployment: "brands",
      }),
    ]);
  });

  it("builds only restart argv for restart mode", async () => {
    const calls: string[][] = [];
    const app = await seededApp(async (args) => {
      calls.push(args);
      return { ok: true, code: 0, stdout: "", stderr: "" };
    });
    const res = await app.request("/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(runBody),
    });
    expect(res.status).toBe(200);
    await readSse(res);
    expect(calls).toEqual([
      rolloutRestartArgs({
        context: runBody.context,
        namespace: "personalization-service",
        deployment: "brands",
      }),
    ]);
    expect(annotateExternalSecretArgs({
      context: "ctx",
      namespace: "ns",
      externalSecret: "svc-env",
      forceSync: "1",
    })).toEqual([
      "--context",
      "ctx",
      "--namespace",
      "ns",
      "annotate",
      "es",
      "svc-env",
      "force-sync=1",
      "--overwrite",
    ]);
  });
});

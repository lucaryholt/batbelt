import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyConfig } from "./config.js";
import { createRoutes } from "./routes.js";

describe("homepage routes", () => {
  const prev = process.env.XDG_CONFIG_HOME;
  let dir: string;

  afterEach(() => {
    if (prev === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = prev;
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  function app() {
    dir = mkdtempSync(join(tmpdir(), "batbelt-homepage-"));
    process.env.XDG_CONFIG_HOME = dir;
    return createRoutes();
  }

  it("starts empty and accepts a section", async () => {
    const hono = app();
    const empty = await hono.request("/config");
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual(emptyConfig());

    const saved = await hono.request("/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sections: [
          {
            id: "airflow",
            title: "Airflow",
            collapsed: false,
            shortcuts: [{ id: "dev", label: "Dev", url: "https://airflow-dev.example.com" }],
          },
        ],
      }),
    });
    expect(saved.status).toBe(200);
    const body = (await saved.json()) as { sections: { title: string; shortcuts: { kind: string }[] }[] };
    expect(body.sections[0].title).toBe("Airflow");
    expect(body.sections[0].shortcuts[0].kind).toBe("url");
  });

  it("rejects javascript: shortcut URLs on PUT", async () => {
    const hono = app();
    const res = await hono.request("/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sections: [
          {
            id: "airflow",
            title: "Airflow",
            collapsed: false,
            shortcuts: [{ id: "dev", label: "Dev", url: "javascript:alert(1)" }],
          },
        ],
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toMatch(/http or https/i);
  });

  it("rejects folder shortcuts", async () => {
    const hono = app();
    const res = await hono.request("/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sections: [
          {
            id: "projects",
            title: "Projects",
            shortcuts: [{ id: "p1", kind: "dir", label: "gone", path: "/definitely/not/here", tool: "code" }],
          },
        ],
      }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringMatching(/folder shortcuts are no longer supported/i) });
  });
});

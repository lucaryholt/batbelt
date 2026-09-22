import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

  function app(
    openDirectory?: (input: { path: string; tool: string; terminal: unknown }) => Promise<{ path: string }>,
    lookPath?: (bin: string) => Promise<boolean>,
  ) {
    dir = mkdtempSync(join(tmpdir(), "batbelt-homepage-"));
    process.env.XDG_CONFIG_HOME = dir;
    return createRoutes({
      openDirectory: openDirectory as never,
      lookPath,
    });
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
    const body = (await saved.json()) as { sections: { title: string; shortcuts: { kind: string }[] }[]; terminal: { kind: string } };
    expect(body.sections[0].title).toBe("Airflow");
    expect(body.sections[0].shortcuts[0].kind).toBe("url");
    expect(body.terminal.kind).toBe("terminal-app");
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

  it("reports which launch tools are on PATH", async () => {
    const hono = app(undefined, async (bin) => bin === "code" || bin === "pi");
    const res = await hono.request("/tools");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      code: true,
      pi: true,
      kitten: false,
      kitty: false,
    });
  });

  it("opens a saved directory shortcut by id", async () => {
    const opened: unknown[] = [];
    const folder = mkdtempSync(join(tmpdir(), "batbelt-dir-"));
    const hono = app(async (input) => {
      opened.push(input);
      return { path: input.path };
    });
    await hono.request("/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        terminal: { kind: "kitty-tab", listenOn: "unix:/tmp/mykitty" },
        sections: [
          {
            id: "projects",
            title: "Projects",
            shortcuts: [{ id: "p1", kind: "dir", label: "proj", path: folder, tool: "code" }],
          },
        ],
      }),
    });
    const res = await hono.request("/open", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "p1" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ path: folder });
    expect(opened).toEqual([
      { path: folder, tool: "code", terminal: { kind: "kitty-tab", listenOn: "unix:/tmp/mykitty" } },
    ]);
  });

  it("rejects opening a URL shortcut", async () => {
    const hono = app(async () => ({ path: "/nope" }));
    await hono.request("/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sections: [
          {
            id: "airflow",
            title: "Airflow",
            shortcuts: [{ id: "dev", kind: "url", label: "Dev", url: "https://example.com" }],
          },
        ],
      }),
    });
    const res = await hono.request("/open", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "dev" }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringMatching(/not a directory shortcut/i) });
  });

  it("rejects a missing shortcut id", async () => {
    const hono = app();
    const res = await hono.request("/open", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "missing" }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringMatching(/unknown shortcut/i) });
  });

  it("rejects a path that is not a directory", async () => {
    const folder = mkdtempSync(join(tmpdir(), "batbelt-file-"));
    const file = join(folder, "readme.txt");
    writeFileSync(file, "hi");
    const hono = app(async () => ({ path: file }));
    await hono.request("/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sections: [
          {
            id: "projects",
            title: "Projects",
            shortcuts: [{ id: "p1", kind: "dir", label: "file", path: file, tool: "code" }],
          },
        ],
      }),
    });
    const res = await hono.request("/open", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "p1" }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringMatching(/not a directory/i) });
  });

  it("rejects a missing directory", async () => {
    const hono = app();
    await hono.request("/config", {
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
    const res = await hono.request("/open", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "p1" }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringMatching(/directory not found/i) });
  });
});

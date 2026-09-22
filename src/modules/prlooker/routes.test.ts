import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveConfig } from "./config.js";
import { createRoutes } from "./routes.js";
import type { GhResult } from "./types.js";

describe("prlooker routes", () => {
  const prev = process.env.XDG_CONFIG_HOME;
  let dir: string;

  afterEach(() => {
    if (prev === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = prev;
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  function app(runGh?: (args: string[]) => Promise<GhResult>) {
    dir = mkdtempSync(join(tmpdir(), "batbelt-prlooker-"));
    process.env.XDG_CONFIG_HOME = dir;
    return createRoutes({ runGh });
  }

  it("returns default config", async () => {
    const hono = app();
    const res = await hono.request("/config");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pollSeconds: 60, teams: [] });
  });

  it("returns health from gh api user", async () => {
    const hono = app(async () => ({
      ok: true,
      code: 0,
      stdout: JSON.stringify({ login: "ada" }),
      stderr: "",
    }));
    const res = await hono.request("/health");
    expect(await res.json()).toEqual({ ghAvailable: true, loggedIn: true, login: "ada" });
  });

  it("merges inbox searches", async () => {
    const hono = app(async (args) => {
      if (args[0] === "api") {
        return { ok: true, code: 0, stdout: JSON.stringify({ login: "ada" }), stderr: "" };
      }
      return {
        ok: true,
        code: 0,
        stdout: JSON.stringify([
          {
            number: 1,
            title: "One",
            url: `https://github.com/acme/app/pull/${args[2]}`,
            repository: { nameWithOwner: "acme/app" },
            author: { login: "ada" },
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-02T00:00:00Z",
            isDraft: false,
            labels: [],
          },
        ]),
        stderr: "",
      };
    });
    await saveConfig({ pollSeconds: 60, teams: [] });
    const res = await hono.request("/inbox");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { viewer?: string; items: { url: string }[] };
    expect(body.viewer).toBe("ada");
    expect(body.items.length).toBeGreaterThan(0);
  });

  it("returns gh errors as 500", async () => {
    const hono = app(async () => ({
      ok: false,
      code: 1,
      stdout: "",
      stderr: "HTTP 401",
    }));
    const res = await hono.request("/inbox");
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: expect.stringMatching(/401/) });
  });
});

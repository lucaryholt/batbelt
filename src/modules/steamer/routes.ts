import { access, unlink } from "node:fs/promises";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type {
  AppConfig,
  CompareResponse,
  ExistsResponse,
  HealthResponse,
  ListResponse,
  WriteRequest,
  WriteResponse,
} from "./types.js";
import {
  baoVersion,
  kvGet,
  kvList,
  kvPut,
  loginOidc,
  redactOutput,
  revokeToken,
  tokenLookup,
} from "./bao.js";
import { findEnvironment, loadConfig, saveConfig } from "./config.js";
import { configFilePath, tokenPath } from "./paths.js";
import { openInCode } from "../../open-in-code.js";

const loginLocks = new Set<string>();

function mountFor(envMount: string | undefined, override?: string): string {
  const value = (override ?? envMount ?? "secret").trim();
  if (!value) return "secret";
  return value.replace(/^\/+|\/+$/g, "");
}

function cleanPath(path: string): string {
  return path.trim().replace(/^\/+|\/+$/g, "");
}

export function createRoutes(): Hono {
  const app = new Hono();

  app.get("/health", async (c) => {
    const version = await baoVersion();
    const body: HealthResponse = {
      baoAvailable: version.ok,
      baoVersion: version.version,
    };
    return c.json(body);
  });

  app.get("/config", async (c) => {
    return c.json(await loadConfig());
  });

  app.put("/config", async (c) => {
    const body = (await c.req.json()) as AppConfig;
    try {
      const saved = await saveConfig(body);
      return c.json(saved);
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
        await saveConfig({ environments: [] });
      }
      const result = await openInCode(configFilePath());
      return c.json(result);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  app.get("/status", async (c) => {
    const config = await loadConfig();
    const environments = await Promise.all(
      config.environments.map(async (env) => {
        const lookup = await tokenLookup(env);
        return {
          name: env.name,
          addr: env.addr,
          loggedIn: lookup.loggedIn,
          ttl: lookup.ttl,
          displayName: lookup.displayName,
          error: lookup.loggedIn ? undefined : lookup.error,
        };
      }),
    );
    return c.json({ environments });
  });

  app.get("/envs/:name/login", async (c) => {
    const name = c.req.param("name");
    let environment;
    try {
      environment = await findEnvironment(name);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 404);
    }
    if (loginLocks.has(environment.name)) {
      return c.json({ error: "A login is already in progress for this environment" }, 409);
    }
    loginLocks.add(environment.name);
    return streamSSE(c, async (stream) => {
      try {
        const result = await loginOidc(environment, async (line) => {
          await stream.writeSSE({ data: JSON.stringify({ type: "log", line }) });
        });
        await stream.writeSSE({
          data: JSON.stringify({
            type: result.ok ? "done" : "error",
            error: result.ok
              ? undefined
              : redactOutput(result.stderr || result.stdout || "Login failed"),
          }),
        });
      } finally {
        loginLocks.delete(environment.name);
      }
    });
  });

  app.post("/envs/:name/logout", async (c) => {
    const name = c.req.param("name");
    let environment;
    try {
      environment = await findEnvironment(name);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 404);
    }
    await revokeToken(environment);
    await unlink(tokenPath(environment.name)).catch(() => undefined);
    return c.json({ ok: true });
  });

  app.get("/secrets", async (c) => {
    const mount = c.req.query("mount") ?? "";
    const path = cleanPath(c.req.query("path") ?? "");
    if (!path) return c.json({ error: "path is required" }, 400);
    const config = await loadConfig();
    const results: CompareResponse["results"] = {};
    await Promise.all(
      config.environments.map(async (env) => {
        results[env.name] = await kvGet(env, mountFor(env.kvMount, mount), path);
      }),
    );
    return c.json({ results } satisfies CompareResponse);
  });

  app.get("/secrets/list", async (c) => {
    const mount = c.req.query("mount") ?? "";
    const path = cleanPath(c.req.query("path") ?? "");
    const config = await loadConfig();
    const results: ListResponse["results"] = {};
    await Promise.all(
      config.environments.map(async (env) => {
        results[env.name] = await kvList(env, mountFor(env.kvMount, mount), path);
      }),
    );
    return c.json({ results } satisfies ListResponse);
  });

  app.post("/secrets/exists", async (c) => {
    const body = (await c.req.json()) as {
      mount?: string;
      path?: string;
      envNames?: string[];
    };
    const path = cleanPath(body.path ?? "");
    if (!path) return c.json({ error: "path is required" }, 400);
    const config = await loadConfig();
    const names = body.envNames?.length
      ? body.envNames
      : config.environments.map((env) => env.name);
    const exists: ExistsResponse["exists"] = {};
    await Promise.all(
      names.map(async (name) => {
        const env = config.environments.find((item) => item.name === name);
        if (!env) {
          exists[name] = false;
          return;
        }
        const result = await kvGet(env, mountFor(env.kvMount, body.mount), path);
        exists[name] = result.ok;
      }),
    );
    return c.json({ exists } satisfies ExistsResponse);
  });

  app.post("/secrets", async (c) => {
    // Keep the write implementation below so it can be restored once the
    // feature is ready, but enforce read-only behavior at the API boundary.
    return c.json(
      { error: "Secret writes are disabled. Edit this path in the OpenBao UI." },
      403,
    );

    const body = (await c.req.json()) as WriteRequest;
    const path = cleanPath(body.path ?? "");
    const values = body.values ?? {};
    const envNames = Object.keys(values);
    if (!path) return c.json({ error: "path is required" }, 400);
    if (!envNames.length) return c.json({ error: "No environments selected" }, 400);
    if (!body.confirm) {
      return c.json({ error: "confirm is required" }, 400);
    }

    const config = await loadConfig();

    const results: WriteResponse["results"] = {};
    await Promise.all(
      envNames.map(async (name) => {
        const env = config.environments.find((item) => item.name === name);
        if (!env) {
          results[name] = { ok: false, error: "Unknown environment" };
          return;
        }
        results[name] = await kvPut(
          env,
          mountFor(env.kvMount, body.mount),
          path,
          values[name] ?? {},
        );
      }),
    );
    return c.json({ results } satisfies WriteResponse);
  });

  return app;
}

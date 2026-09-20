import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { App } from "../app.js";
import { ensureEntryIdentity, parseConfigYaml, proxyGroupKey, tagSetKey } from "../config/index.js";
import type { ProxyService, Service } from "../config/index.js";
import { ProxyForward } from "../proxy/pod.js";
import { getPortUsage } from "../ports/checker.js";

type ErrorStatus = 400 | 403 | 404 | 409 | 500;

function nameTagKey(name: string, tags: string[] | undefined): string {
  return `${name}\n${tagSetKey(tags ?? [])}`;
}

function hasNameTagConflict(
  entries: { id: string; name: string; tags: string[] }[],
  candidate: { id?: string; name: string; tags?: string[] },
  excludeId?: string,
): boolean {
  const key = nameTagKey(candidate.name, candidate.tags);
  return entries.some((x) => x.id !== excludeId && nameTagKey(x.name, x.tags) === key);
}

function httpError(err: unknown): { status: ErrorStatus; message: string } {
  const message = err instanceof Error ? err.message : String(err);
  const raw = typeof err === "object" && err && "status" in err ? Number((err as { status: number }).status) : 500;
  const allowed: ErrorStatus[] = [400, 403, 404, 409, 500];
  const status = allowed.includes(raw as ErrorStatus) ? (raw as ErrorStatus) : 500;
  return { status, message };
}

export function createApp(app: App): Hono {
  const hono = new Hono();

  const requireWritable = () => {
    if (!app.store.writable) {
      const err = Object.assign(new Error("configuration is read-only (YAML store)"), { status: 403 });
      throw err;
    }
  };

  hono.get("/state", (c) => {
    return streamSSE(c, async (stream) => {
      let closed = false;
      const send = async (json: string) => {
        if (closed) return;
        try {
          await stream.writeSSE({ data: json });
        } catch {
          closed = true;
        }
      };
      await send(app.currentStateJson());
      const unsub = app.subscribe((json) => {
        void send(json);
      });
      const heartbeat = setInterval(() => {
        void send(app.currentStateJson());
      }, 2000);
      try {
        while (!closed) {
          await stream.sleep(30_000);
        }
      } finally {
        closed = true;
        clearInterval(heartbeat);
        unsub();
      }
    });
  });

  hono.get("/services", (c) => {
    return c.json(
      app.portForwards.map((pf) => ({
        id: pf.service.id,
        name: pf.service.name,
        status: pf.status,
      })),
    );
  });

  hono.post("/services/start-all", async (c) => {
    await Promise.all(app.portForwards.map((pf) => pf.start().catch(() => undefined)));
    return c.json({ status: "ok" });
  });

  hono.post("/services/stop-all", (c) => {
    for (const pf of app.portForwards) {
      if (pf.isRunning()) pf.stop();
    }
    return c.json({ status: "ok" });
  });

  hono.post("/services/start-defaults", async (c) => {
    await Promise.all(
      app.portForwards.filter((pf) => pf.service.selected_by_default).map((pf) => pf.start().catch(() => undefined)),
    );
    return c.json({ status: "ok" });
  });

  hono.post("/services/:id/start", async (c) => {
    const pf = app.findForward(c.req.param("id"));
    if (!pf) return c.json({ error: "service not found" }, 404);
    try {
      await pf.start();
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 409);
    }
    return c.json({ status: "starting" });
  });

  hono.post("/services/:id/stop", (c) => {
    const pf = app.findForward(c.req.param("id"));
    if (!pf) return c.json({ error: "service not found" }, 404);
    pf.stop();
    return c.json({ status: "stopped" });
  });

  hono.post("/proxy-services/start-pod", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { group_key?: string } | null;
    if (!body?.group_key) return c.json({ error: "invalid body: group_key required" }, 400);
    const mgr = app.proxyPodManagers.get(body.group_key);
    if (!mgr) return c.json({ error: "group not found" }, 404);
    const allSvcs = app.config.proxy_services.filter((ps) => proxyGroupKey(ps) === body.group_key);
    if (!allSvcs.length) return c.json({ error: "no services in group" }, 400);
    for (const [name, pxf] of [...app.proxyForwards]) {
      if (proxyGroupKey(pxf.proxyService) === body.group_key) {
        pxf.stop();
        app.proxyForwards.delete(name);
      }
    }
    void mgr.createPodWithServices(allSvcs).catch(() => undefined);
    return c.json({ status: "starting" });
  });

  hono.post("/proxy-services/start-defaults", async (c) => {
    if (app.proxyPodManagers.size === 0) return c.json({ error: "no proxy services configured" }, 400);
    void app.startDefaultProxies();
    return c.json({ status: "starting" });
  });

  hono.post("/proxy-services/:id/start", async (c) => {
    const id = c.req.param("id");
    const ps = app.config.proxy_services.find((s) => s.id === id);
    if (!ps) return c.json({ error: "proxy service not found" }, 404);
    const mgr = app.proxyPodManagers.get(proxyGroupKey(ps));
    if (!mgr) return c.json({ error: "group not found" }, 404);
    if (app.proxyForwards.has(id)) return c.json({ status: "already running" });
    const pxf = new ProxyForward(ps, mgr, app.config.max_retries, () => app.notify());
    app.proxyForwards.set(id, pxf);
    void pxf.start().catch(() => undefined);
    return c.json({ status: "starting" });
  });

  hono.post("/proxy-services/:id/stop", (c) => {
    const id = c.req.param("id");
    const pxf = app.proxyForwards.get(id);
    if (!pxf) return c.json({ status: "not running" });
    app.proxyForwards.delete(id);
    pxf.stop();
    return c.json({ status: "stopped" });
  });

  hono.post("/proxy-services/reset", async (c) => {
    if (app.proxyPodManagers.size === 0) return c.json({ error: "no proxy services configured" }, 400);
    const activeByGroup = new Map<string, Set<string>>();
    for (const [id, pxf] of app.proxyForwards) {
      const key = proxyGroupKey(pxf.proxyService);
      const set = activeByGroup.get(key) ?? new Set();
      set.add(id);
      activeByGroup.set(key, set);
    }
    for (const pxf of app.proxyForwards.values()) pxf.stop();
    app.proxyForwards.clear();

    void (async () => {
      for (const [key, mgr] of app.proxyPodManagers) {
        await mgr.deletePod().catch(() => undefined);
        const allSvcs = app.config.proxy_services.filter((ps) => proxyGroupKey(ps) === key);
        if (!allSvcs.length) continue;
        try {
          await mgr.createPodWithServices(allSvcs);
          const active = activeByGroup.get(key) ?? new Set();
          for (const ps of allSvcs) {
            if (!active.has(ps.id)) continue;
            const pxf = new ProxyForward(ps, mgr, app.config.max_retries, () => app.notify());
            void pxf.start().catch(() => undefined);
            app.proxyForwards.set(ps.id, pxf);
          }
        } catch {
          /* pod error on manager */
        }
      }
      app.notify();
    })();

    return c.json({ status: "resetting" });
  });

  hono.post("/proxy-services/kill-pod", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { group_key?: string } | null;
    if (!body?.group_key) return c.json({ error: "invalid body: group_key required" }, 400);
    const mgr = app.proxyPodManagers.get(body.group_key);
    if (!mgr) return c.json({ error: "group not found" }, 404);
    for (const [name, pxf] of [...app.proxyForwards]) {
      if (proxyGroupKey(pxf.proxyService) === body.group_key) {
        pxf.stop();
        app.proxyForwards.delete(name);
      }
    }
    await mgr.deletePod();
    return c.json({ status: "killed" });
  });

  hono.get("/contexts", (c) => c.json(app.config.alternative_contexts));

  hono.post("/contexts/switch", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { context?: string } | null;
    if (!body?.context) return c.json({ error: "invalid body: context required" }, 400);
    try {
      await app.switchContext(body.context);
    } catch (err) {
      const { status, message } = httpError(err);
      return c.json({ error: message }, status);
    }
    return c.json({ status: "switched", context: app.config.cluster_context });
  });

  hono.get("/ports", async (c) => c.json(await app.listPorts()));

  hono.post("/ports/:port/kill", async (c) => {
    const port = Number(c.req.param("port"));
    if (!Number.isFinite(port)) return c.json({ error: "invalid port" }, 400);
    const usage = await getPortUsage(port);
    if (!usage.inUse || usage.pid <= 0) return c.json({ error: "no process found on that port" }, 404);
    try {
      await app.killPortPid(usage.pid);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
    return c.json({ status: "killed" });
  });

  hono.post("/config/reload", (c) => {
    try {
      app.reloadFromStore();
    } catch (err) {
      return c.json({ error: `failed to reload config: ${err instanceof Error ? err.message : String(err)}` }, 500);
    }
    return c.json({ status: "reloaded" });
  });

  hono.post("/config/import-yaml", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { yaml?: string } | null;
    if (!body?.yaml?.trim()) return c.json({ error: "invalid body: yaml required" }, 400);
    try {
      const cfg = parseConfigYaml(body.yaml);
      app.importYamlAndApply(cfg);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
    return c.json({ status: "imported" });
  });

  hono.post("/config/services", async (c) => {
    try {
      requireWritable();
      const sv = (await c.req.json()) as Service;
      ensureEntryIdentity(sv);
      app.persistAndReload((cfg) => {
        if (cfg.services.some((x) => x.id === sv.id)) {
          throw Object.assign(new Error("service id already exists"), { status: 409 });
        }
        if (hasNameTagConflict(cfg.services, sv)) {
          throw Object.assign(new Error("a service with this name and tags already exists"), { status: 409 });
        }
        cfg.services.push(sv);
      });
    } catch (err) {
      const { status, message } = httpError(err);
      return c.json({ error: message }, status);
    }
    return c.json({ status: "ok" });
  });

  hono.get("/config/services/:id", (c) => {
    const sv = app.config.services.find((s) => s.id === c.req.param("id"));
    if (!sv) return c.json({ error: "service not found" }, 404);
    return c.json(sv);
  });

  hono.put("/config/services/:id", async (c) => {
    try {
      requireWritable();
      const id = c.req.param("id");
      const sv = (await c.req.json()) as Service;
      ensureEntryIdentity(sv);
      if (!sv.id) sv.id = id;
      app.persistAndReload((cfg) => {
        const i = cfg.services.findIndex((x) => x.id === id);
        if (i < 0) throw Object.assign(new Error("service not found"), { status: 404 });
        if (sv.id !== id && cfg.services.some((x) => x.id === sv.id)) {
          throw Object.assign(new Error("service id already exists"), { status: 409 });
        }
        if (hasNameTagConflict(cfg.services, sv, id)) {
          throw Object.assign(new Error("a service with this name and tags already exists"), { status: 409 });
        }
        cfg.services[i] = sv;
      });
    } catch (err) {
      const { status, message } = httpError(err);
      return c.json({ error: message }, status);
    }
    return c.json({ status: "ok" });
  });

  hono.delete("/config/services/:id", (c) => {
    try {
      requireWritable();
      const id = c.req.param("id");
      app.persistAndReload((cfg) => {
        const before = cfg.services.length;
        cfg.services = cfg.services.filter((x) => x.id !== id);
        if (cfg.services.length === before) throw Object.assign(new Error("service not found"), { status: 404 });
      });
    } catch (err) {
      const { status, message } = httpError(err);
      return c.json({ error: message }, status);
    }
    return c.json({ status: "ok" });
  });

  hono.post("/config/proxy-services", async (c) => {
    try {
      requireWritable();
      const ps = (await c.req.json()) as ProxyService;
      ensureEntryIdentity(ps);
      app.persistAndReload((cfg) => {
        if (cfg.proxy_services.some((x) => x.id === ps.id)) {
          throw Object.assign(new Error("proxy service id already exists"), { status: 409 });
        }
        if (hasNameTagConflict(cfg.proxy_services, ps)) {
          throw Object.assign(new Error("a proxy service with this name and tags already exists"), { status: 409 });
        }
        cfg.proxy_services.push(ps);
      });
    } catch (err) {
      const { status, message } = httpError(err);
      return c.json({ error: message }, status);
    }
    return c.json({ status: "ok" });
  });

  hono.get("/config/proxy-services/:id", (c) => {
    const ps = app.config.proxy_services.find((s) => s.id === c.req.param("id"));
    if (!ps) return c.json({ error: "proxy service not found" }, 404);
    return c.json(ps);
  });

  hono.put("/config/proxy-services/:id", async (c) => {
    try {
      requireWritable();
      const id = c.req.param("id");
      const ps = (await c.req.json()) as ProxyService;
      ensureEntryIdentity(ps);
      if (!ps.id) ps.id = id;
      app.persistAndReload((cfg) => {
        const i = cfg.proxy_services.findIndex((x) => x.id === id);
        if (i < 0) throw Object.assign(new Error("proxy service not found"), { status: 404 });
        if (ps.id !== id && cfg.proxy_services.some((x) => x.id === ps.id)) {
          throw Object.assign(new Error("proxy service id already exists"), { status: 409 });
        }
        if (hasNameTagConflict(cfg.proxy_services, ps, id)) {
          throw Object.assign(new Error("a proxy service with this name and tags already exists"), { status: 409 });
        }
        cfg.proxy_services[i] = ps;
      });
    } catch (err) {
      const { status, message } = httpError(err);
      return c.json({ error: message }, status);
    }
    return c.json({ status: "ok" });
  });

  hono.delete("/config/proxy-services/:id", (c) => {
    try {
      requireWritable();
      const id = c.req.param("id");
      app.persistAndReload((cfg) => {
        const before = cfg.proxy_services.length;
        cfg.proxy_services = cfg.proxy_services.filter((x) => x.id !== id);
        if (cfg.proxy_services.length === before) {
          throw Object.assign(new Error("proxy service not found"), { status: 404 });
        }
      });
    } catch (err) {
      const { status, message } = httpError(err);
      return c.json({ error: message }, status);
    }
    return c.json({ status: "ok" });
  });

  hono.get("/explorer/contexts", async (c) => {
    try {
      requireWritable();
      return c.json(await app.explorer.discoverContexts());
    } catch (err) {
      const { status, message } = httpError(err);
      return c.json({ error: message }, status);
    }
  });

  hono.get("/explorer/namespaces", async (c) => {
    try {
      requireWritable();
      const kubeCtx = c.req.query("context");
      if (!kubeCtx) return c.json({ error: "context query parameter required" }, 400);
      return c.json(await app.explorer.discoverNamespaces(kubeCtx));
    } catch (err) {
      const { status, message } = httpError(err);
      return c.json({ error: message }, status);
    }
  });

  hono.get("/explorer/services", async (c) => {
    try {
      requireWritable();
      const kubeCtx = c.req.query("context");
      const ns = c.req.query("namespace");
      if (!kubeCtx || !ns) return c.json({ error: "context and namespace query parameters required" }, 400);
      return c.json(await app.explorer.discoverServices(kubeCtx, ns, app.config));
    } catch (err) {
      const { status, message } = httpError(err);
      return c.json({ error: message }, status);
    }
  });

  hono.get("/explorer/gcp/projects", async (c) => {
    try {
      requireWritable();
      return c.json(await app.explorer.discoverGCPProjects());
    } catch (err) {
      const { status, message } = httpError(err);
      return c.json({ error: message }, status);
    }
  });

  hono.get("/explorer/gcp", async (c) => {
    try {
      requireWritable();
      const project = c.req.query("project") ?? "";
      return c.json(await app.explorer.discoverGCP(project, app.config));
    } catch (err) {
      const { status, message } = httpError(err);
      return c.json({ error: message }, status);
    }
  });

  return hono;
}

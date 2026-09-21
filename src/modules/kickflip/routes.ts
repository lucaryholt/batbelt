import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { defaultContext, findContext, findService, loadConfig, writeSeedIfMissing } from "./config.js";
import { annotateExternalSecretArgs, kubectlHealth, rolloutRestartArgs, runKubectl } from "./kubectl.js";
import { configFilePath } from "./paths.js";
import { openInCode } from "../../open-in-code.js";
import type {
  ConfigResponse,
  HealthResponse,
  KubectlResult,
  ResolvedService,
  RunMode,
  RunRequest,
} from "./types.js";

export interface KickflipDeps {
  runKubectl?: (
    args: string[],
    onLine?: (line: string) => void | Promise<void>,
  ) => Promise<KubectlResult>;
  kubectlHealth?: () => Promise<{ ok: boolean; version?: string }>;
  now?: () => number;
}

function isRunMode(value: unknown): value is RunMode {
  return value === "restart" || value === "secrets-restart";
}

export function createRoutes(deps: KickflipDeps = {}): Hono {
  const exec = deps.runKubectl ?? runKubectl;
  const health = deps.kubectlHealth ?? kubectlHealth;
  const now = deps.now ?? (() => Math.floor(Date.now() / 1000));
  const app = new Hono();
  let running = false;

  app.get("/health", async (c) => {
    const result = await health();
    const body: HealthResponse = {
      kubectlAvailable: result.ok,
      kubectlVersion: result.version,
    };
    return c.json(body);
  });

  app.get("/config", async (c) => {
    try {
      const config = await loadConfig();
      const body: ConfigResponse = {
        contexts: config.contexts,
        namespaces: config.namespaces,
        defaultContext: defaultContext(config).context,
      };
      return c.json(body);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  });

  app.post("/config/open", async (c) => {
    try {
      await writeSeedIfMissing();
      const result = await openInCode(configFilePath());
      return c.json(result);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  app.post("/config/reload", async (c) => {
    try {
      const config = await loadConfig();
      const body: ConfigResponse = {
        contexts: config.contexts,
        namespaces: config.namespaces,
        defaultContext: defaultContext(config).context,
      };
      return c.json(body);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  });

  app.post("/run", async (c) => {
    let body: RunRequest;
    try {
      body = (await c.req.json()) as RunRequest;
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    if (!body.confirm) {
      return c.json({ error: "confirm is required" }, 400);
    }
    if (!isRunMode(body.mode)) {
      return c.json({ error: "mode must be restart or secrets-restart" }, 400);
    }
    const contextName = String(body.context ?? "").trim();
    if (!contextName) return c.json({ error: "context is required" }, 400);
    const selected = Array.isArray(body.services) ? body.services : [];
    if (!selected.length) return c.json({ error: "Select at least one service" }, 400);

    let config;
    try {
      config = await loadConfig();
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }

    const cluster = findContext(config, contextName);
    if (!cluster) return c.json({ error: `Unknown context: ${contextName}` }, 400);

    const resolved: ResolvedService[] = [];
    for (const ref of selected) {
      const namespace = String(ref.namespace ?? "").trim();
      const name = String(ref.name ?? "").trim();
      const service = findService(config, namespace, name);
      if (!service) {
        return c.json({ error: `Unknown service: ${namespace}/${name}` }, 400);
      }
      resolved.push(service);
    }

    if (running) {
      return c.json({ error: "A Kickflip run is already in progress" }, 409);
    }
    running = true;

    return streamSSE(c, async (stream) => {
      const send = async (event: Record<string, unknown>) => {
        await stream.writeSSE({ data: JSON.stringify(event) });
      };
      try {
        await send({
          type: "log",
          line: `Kickflip ${body.mode} on ${cluster.context} (${resolved.length} service${resolved.length === 1 ? "" : "s"})`,
        });
        for (const service of resolved) {
          await send({ type: "log", line: `--- ${service.namespace}/${service.name} ---` });
          let failed = false;
          let error: string | undefined;

          if (body.mode === "secrets-restart") {
            const args = annotateExternalSecretArgs({
              context: cluster.context,
              namespace: service.namespace,
              externalSecret: service.externalSecret,
              forceSync: String(now()),
            });
            await send({ type: "log", line: `kubectl ${args.join(" ")}` });
            try {
              const result = await exec(args, async (line) => {
                await send({ type: "log", line });
              });
              if (!result.ok) {
                failed = true;
                error = (result.stderr || result.stdout || `exit ${result.code}`).trim();
                await send({ type: "log", line: error });
              }
            } catch (err) {
              failed = true;
              error = (err as Error).message;
              await send({ type: "log", line: error });
            }
          }

          const restartArgs = rolloutRestartArgs({
            context: cluster.context,
            namespace: service.namespace,
            deployment: service.deployment,
          });
          await send({ type: "log", line: `kubectl ${restartArgs.join(" ")}` });
          try {
            const result = await exec(restartArgs, async (line) => {
              await send({ type: "log", line });
            });
            if (!result.ok) {
              failed = true;
              error = (result.stderr || result.stdout || `exit ${result.code}`).trim();
              await send({ type: "log", line: error });
            }
          } catch (err) {
            failed = true;
            error = (err as Error).message;
            await send({ type: "log", line: error });
          }

          await send({
            type: "service",
            namespace: service.namespace,
            name: service.name,
            ok: !failed,
            error,
          });
        }
        await send({ type: "done" });
      } catch (err) {
        await send({ type: "error", error: (err as Error).message });
      } finally {
        running = false;
      }
    });
  });

  return app;
}

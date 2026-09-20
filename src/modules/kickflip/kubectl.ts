import { spawn } from "node:child_process";
import type { KubectlResult } from "./types.js";

const DEFAULT_TIMEOUT_MS = 60_000;
const HEALTH_TIMEOUT_MS = 15_000;

export function annotateExternalSecretArgs(opts: {
  context: string;
  namespace: string;
  externalSecret: string;
  forceSync: string;
}): string[] {
  return [
    "--context",
    opts.context,
    "--namespace",
    opts.namespace,
    "annotate",
    "es",
    opts.externalSecret,
    `force-sync=${opts.forceSync}`,
    "--overwrite",
  ];
}

export function rolloutRestartArgs(opts: {
  context: string;
  namespace: string;
  deployment: string;
}): string[] {
  return [
    "--context",
    opts.context,
    "--namespace",
    opts.namespace,
    "rollout",
    "restart",
    `deployment/${opts.deployment}`,
  ];
}

async function emitLines(
  chunk: string,
  carry: { rest: string },
  onLine?: (line: string) => void | Promise<void>,
): Promise<void> {
  if (!onLine) return;
  const text = carry.rest + chunk;
  const parts = text.split(/\r?\n/);
  carry.rest = parts.pop() ?? "";
  for (const line of parts) {
    const trimmed = line.trimEnd();
    if (trimmed) await onLine(trimmed);
  }
}

export function runKubectl(
  args: string[],
  onLine?: (line: string) => void | Promise<void>,
  options: { timeoutMs?: number } = {},
): Promise<KubectlResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("kubectl", args, {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const outCarry = { rest: "" };
    const errCarry = { rest: "" };
    const writes: Promise<void>[] = [];
    child.stdout?.on("data", (d: Buffer) => {
      const chunk = d.toString();
      stdout += chunk;
      writes.push(emitLines(chunk, outCarry, onLine));
    });
    child.stderr?.on("data", (d: Buffer) => {
      const chunk = d.toString();
      stderr += chunk;
      writes.push(emitLines(chunk, errCarry, onLine));
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      void Promise.all(writes)
        .then(async () => {
          if (outCarry.rest.trim()) await onLine?.(outCarry.rest.trim());
          if (errCarry.rest.trim()) await onLine?.(errCarry.rest.trim());
          if (timedOut) {
            reject(new Error(`kubectl ${args.join(" ")} timed out`));
            return;
          }
          const status = code ?? 1;
          resolve({
            ok: status === 0,
            code: status,
            stdout,
            stderr,
          });
        })
        .catch(reject);
    });
  });
}

export async function kubectlHealth(): Promise<{ ok: boolean; version?: string }> {
  try {
    const result = await runKubectl(["version", "--client"], undefined, { timeoutMs: HEALTH_TIMEOUT_MS });
    if (!result.ok) return { ok: false };
    const text = (result.stdout || result.stderr).trim();
    const first = text.split("\n")[0]?.trim();
    return { ok: true, version: first || undefined };
  } catch {
    return { ok: false };
  }
}

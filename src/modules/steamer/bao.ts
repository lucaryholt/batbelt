import { spawn } from "node:child_process";
import { chmod, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Environment, SecretData } from "./types.js";
import { ensureAppDirs, tokenPath } from "./paths.js";

export interface BaoResult {
  ok: boolean;
  code: number;
  stdout: string;
  stderr: string;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const LOGIN_TIMEOUT_MS = 5 * 60_000;

function baoProcessEnv(environment: Environment): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.BAO_TOKEN;
  delete env.VAULT_TOKEN;
  delete env.VAULT_ADDR;
  delete env.VAULT_TOKEN_PATH;
  delete env.VAULT_NAMESPACE;
  env.BAO_ADDR = environment.addr;
  env.BAO_TOKEN_PATH = tokenPath(environment.name);
  if (environment.namespace) {
    env.BAO_NAMESPACE = environment.namespace;
  } else {
    delete env.BAO_NAMESPACE;
  }
  return env;
}

export function redactOutput(text: string): string {
  return text
    .replace(/\b(hvs\.|s\.)[A-Za-z0-9_-]{8,}/g, "[redacted]")
    .replace(/^(\s*token\s+)(\S+)/gim, "$1[redacted]");
}

export async function runBao(
  environment: Environment,
  args: string[],
  options?: {
    stdin?: string;
    timeoutMs?: number;
    onLine?: (line: string) => void | Promise<void>;
  },
): Promise<BaoResult> {
  await ensureAppDirs();
  return new Promise((resolve) => {
    const child = spawn("bao", args, {
      env: baoProcessEnv(environment),
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let lineQueue: Promise<void> = Promise.resolve();

    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void lineQueue.finally(() => {
        resolve({
          ok: code === 0,
          code,
          stdout: stdout.trimEnd(),
          stderr: stderr.trimEnd(),
        });
      });
    };

    const emit = (chunk: Buffer, dest: "stdout" | "stderr") => {
      const text = chunk.toString("utf8");
      if (dest === "stdout") stdout += text;
      else stderr += text;
      if (!options?.onLine) return;
      lineQueue = lineQueue.then(async () => {
        for (const line of text.split(/\r?\n/)) {
          if (line.length) await options.onLine?.(redactOutput(line));
        }
      });
    };

    child.stdout?.on("data", (chunk: Buffer) => emit(chunk, "stdout"));
    child.stderr?.on("data", (chunk: Buffer) => emit(chunk, "stderr"));
    child.on("error", (err) => {
      stderr += err.message;
      finish(127);
    });
    child.on("close", (code) => finish(code ?? 1));

    if (options?.stdin != null) {
      child.stdin?.end(options.stdin);
    } else {
      child.stdin?.end();
    }

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      stderr += "\nTimed out waiting for bao";
      finish(124);
    }, options?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  });
}

export function errorMessage(result: BaoResult, fallback: string): string {
  const text = result.stderr || result.stdout || fallback;
  return redactOutput(text).split("\n").slice(0, 8).join("\n");
}

export async function baoVersion(): Promise<{ ok: boolean; version?: string }> {
  return new Promise((resolve) => {
    const child = spawn("bao", ["version"], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.on("error", () => resolve({ ok: false }));
    child.on("close", (code) => {
      if (code !== 0) {
        resolve({ ok: false });
        return;
      }
      resolve({ ok: true, version: stdout.trim().split("\n")[0] });
    });
  });
}

function parseJson(text: string): unknown {
  const start = text.indexOf("{");
  const arrayStart = text.indexOf("[");
  let payload = text;
  if (start >= 0 && (arrayStart < 0 || start < arrayStart)) {
    payload = text.slice(start);
  } else if (arrayStart >= 0) {
    payload = text.slice(arrayStart);
  }
  return JSON.parse(payload);
}

export async function tokenLookup(environment: Environment): Promise<{
  loggedIn: boolean;
  ttl?: number;
  displayName?: string;
  error?: string;
}> {
  const result = await runBao(environment, ["token", "lookup", "-format=json"]);
  if (!result.ok) {
    return { loggedIn: false, error: errorMessage(result, "Not logged in") };
  }
  try {
    const parsed = parseJson(result.stdout) as {
      data?: { ttl?: number; display_name?: string; meta?: { username?: string } };
    };
    return {
      loggedIn: true,
      ttl: parsed.data?.ttl,
      displayName: parsed.data?.meta?.username ?? parsed.data?.display_name,
    };
  } catch {
    return { loggedIn: true };
  }
}

export async function kvGet(
  environment: Environment,
  mount: string,
  path: string,
): Promise<{ ok: boolean; data?: SecretData; missing?: boolean; error?: string }> {
  const result = await runBao(environment, [
    "kv",
    "get",
    `-mount=${mount}`,
    "-format=json",
    path,
  ]);
  if (!result.ok) {
    const message = errorMessage(result, "Failed to read secret");
    const missing = /no value found|not found|404/i.test(message);
    return { ok: false, missing, error: message };
  }
  try {
    const parsed = parseJson(result.stdout) as {
      data?: { data?: Record<string, unknown>; metadata?: unknown } & Record<string, unknown>;
    };
    const raw =
      parsed.data?.data && typeof parsed.data.data === "object"
        ? parsed.data.data
        : ((parsed.data ?? {}) as Record<string, unknown>);
    const data: SecretData = {};
    for (const [key, value] of Object.entries(raw)) {
      if (key === "metadata") continue;
      data[key] = typeof value === "string" ? value : JSON.stringify(value);
    }
    return { ok: true, data };
  } catch {
    return { ok: false, error: "Could not parse bao kv get output" };
  }
}

export async function kvList(
  environment: Environment,
  mount: string,
  path: string,
): Promise<{ ok: boolean; data?: string[]; error?: string }> {
  const args = ["kv", "list", `-mount=${mount}`, "-format=json"];
  if (path) args.push(path);
  const result = await runBao(environment, args);
  if (!result.ok) {
    const message = errorMessage(result, "Failed to list secrets");
    if (/no value found|not found|404/i.test(message)) {
      return { ok: true, data: [] };
    }
    return { ok: false, error: message };
  }
  try {
    const parsed = parseJson(result.stdout);
    if (Array.isArray(parsed)) {
      return { ok: true, data: parsed.map(String) };
    }
    if (parsed && typeof parsed === "object" && "keys" in parsed) {
      const keys = (parsed as { keys?: unknown }).keys;
      if (Array.isArray(keys)) return { ok: true, data: keys.map(String) };
    }
    if (parsed && typeof parsed === "object" && "data" in parsed) {
      const data = (parsed as { data?: { keys?: unknown } }).data;
      if (Array.isArray(data?.keys)) return { ok: true, data: data.keys.map(String) };
    }
    return { ok: true, data: [] };
  } catch {
    return { ok: false, error: "Could not parse bao kv list output" };
  }
}

export async function kvPut(
  environment: Environment,
  mount: string,
  path: string,
  data: SecretData,
): Promise<{ ok: boolean; version?: number; error?: string }> {
  const dir = await mkdtemp(join(tmpdir(), "bao-helper-"));
  const file = join(dir, "payload.json");
  try {
    await writeFile(file, JSON.stringify(data), { mode: 0o600 });
    await chmod(file, 0o600);
    const result = await runBao(environment, [
      "kv",
      "put",
      `-mount=${mount}`,
      "-format=json",
      path,
      `@${file}`,
    ]);
    if (!result.ok) {
      return { ok: false, error: errorMessage(result, "Failed to write secret") };
    }
    try {
      const parsed = parseJson(result.stdout) as {
        data?: { version?: number };
      };
      return { ok: true, version: parsed.data?.version };
    } catch {
      return { ok: true };
    }
  } finally {
    await unlink(file).catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
  }
}

export async function loginOidc(
  environment: Environment,
  onLine: (line: string) => void | Promise<void>,
): Promise<BaoResult> {
  const args = ["login", "-method=oidc"];
  const mount = environment.oidcMount?.trim();
  if (mount && mount !== "oidc") {
    args.push(`-path=${mount}`);
  }
  const role = environment.oidcRole?.trim();
  if (role) {
    args.push(`role=${role}`);
  }
  onLine(`Running: bao ${args.join(" ")}`);
  onLine(`Address: ${environment.addr}`);
  return runBao(environment, args, {
    timeoutMs: LOGIN_TIMEOUT_MS,
    onLine,
  });
}

export async function revokeToken(environment: Environment): Promise<BaoResult> {
  return runBao(environment, ["token", "revoke", "-self"]);
}

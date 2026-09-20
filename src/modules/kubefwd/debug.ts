import { appendFileSync } from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";

const DEBUG_MAX_LINES = 500;
const DEBUG_LOG_PATH = "/tmp/kubefwd-debug.log";

let debugMode = false;
const debugLines: string[] = [];

export function setDebugMode(enabled: boolean): void {
  debugMode = enabled;
}

export function isDebugMode(): boolean {
  return debugMode;
}

export function debugLog(format: string, ...args: unknown[]): void {
  const msg = formatArgs(format, args);
  const line = `[DEBUG] ${formatTime()}  ${msg}`;
  if (debugMode) {
    process.stderr.write(line + "\n");
    try {
      appendFileSync(DEBUG_LOG_PATH, line + "\n");
    } catch {
      /* ignore */
    }
  }
  debugLines.push(line);
  if (debugLines.length > DEBUG_MAX_LINES) {
    debugLines.splice(0, debugLines.length - DEBUG_MAX_LINES);
  }
}

export function getDebugLines(): string[] {
  return [...debugLines];
}

export function formatArgs(format: string, args: unknown[]): string {
  let i = 0;
  return format.replace(/%[sdj%]/g, (m) => {
    if (m === "%%") return "%";
    const v = args[i++];
    if (m === "%j") {
      try {
        return JSON.stringify(v);
      } catch {
        return String(v);
      }
    }
    return String(v);
  });
}

function formatTime(): string {
  const d = new Date();
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  status: number | null;
}

export function runCommand(
  command: string,
  args: string[],
  options: { timeoutMs?: number; env?: NodeJS.ProcessEnv } = {},
): Promise<RunResult> {
  debugLog("CMD: %s %s", command, args.join(" "));
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    let timedOut = false;
    const timer =
      options.timeoutMs !== undefined
        ? setTimeout(() => {
            timedOut = true;
            child.kill("SIGTERM");
          }, options.timeoutMs)
        : undefined;
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      debugLog("OUT: error=%s", err.message);
      reject(err);
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      const combined = (stdout + stderr).trim();
      if (timedOut) {
        debugLog("OUT: error=timeout  output=%s", combined);
        reject(new Error(`command timed out: ${command} ${args.join(" ")}`));
        return;
      }
      if (code !== 0) {
        if (combined) debugLog("OUT: error=exit %s  output=%s", code, combined);
        else debugLog("OUT: error=exit %s", code);
      } else if (combined) {
        debugLog("OUT: %s", combined);
      } else {
        debugLog("OUT: (ok, no output)");
      }
      resolve({ stdout, stderr, status: code });
    });
  });
}

export async function runCommandOk(
  command: string,
  args: string[],
  options: { timeoutMs?: number; env?: NodeJS.ProcessEnv } = {},
): Promise<string> {
  const result = await runCommand(command, args, options);
  if (result.status !== 0) {
    const out = (result.stdout + result.stderr).trim();
    throw new Error(`${command} ${args.join(" ")} failed (exit ${result.status})${out ? `: ${out}` : ""}`);
  }
  return result.stdout;
}

export function spawnTracked(
  command: string,
  args: string[],
  options: { env?: NodeJS.ProcessEnv } = {},
): ChildProcess {
  return spawn(command, args, {
    env: options.env ?? process.env,
    stdio: ["ignore", "ignore", "pipe"],
  });
}

import { debugLog, runCommand } from "../debug.js";
import type { Config } from "../config/types.js";

export type PortStatus = "free" | "kubefwd" | "external";

export interface PortUsageInfo {
  inUse: boolean;
  pid: number;
  processInfo: string;
  status: PortStatus;
}

export interface ConfigPort {
  port: number;
  serviceName: string;
  type: "Direct" | "Proxy";
}

export async function getPortUsage(port: number): Promise<PortUsageInfo> {
  const info: PortUsageInfo = { inUse: false, pid: 0, processInfo: "", status: "free" };
  const result = await runCommand("lsof", ["-i", `:${port}`, "-P", "-n", "-sTCP:LISTEN"], { timeoutMs: 8000 });
  if (result.status !== 0) {
    if (result.status === 1) return info;
    throw new Error(`failed to run lsof: exit ${result.status} ${(result.stdout + result.stderr).trim()}`);
  }
  const lines = result.stdout.split("\n");
  if (lines.length < 2) return info;
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const fields = line.split(/\s+/);
    if (fields.length < 2) continue;
    const command = fields[0];
    const pid = Number(fields[1]);
    if (!Number.isFinite(pid)) continue;
    info.inUse = true;
    info.pid = pid;
    info.processInfo = command;
    info.status = "external";
    const detailed = await getProcessDetails(pid);
    if (detailed) info.processInfo = detailed;
    break;
  }
  return info;
}

async function getProcessDetails(pid: number): Promise<string> {
  const result = await runCommand("ps", ["-p", String(pid), "-o", "command="], { timeoutMs: 5000 });
  if (result.status !== 0) return "";
  let cmdLine = result.stdout.trim();
  if (cmdLine.length > 60) cmdLine = cmdLine.slice(0, 57) + "...";
  return cmdLine;
}

export function killProcess(pid: number): void {
  if (pid <= 0) throw new Error(`invalid PID: ${pid}`);
  debugLog("CMD: kill -SIGTERM %d", pid);
  try {
    process.kill(pid, "SIGTERM");
  } catch (err) {
    debugLog("OUT: error=%s", err instanceof Error ? err.message : String(err));
    throw new Error(`failed to kill process ${pid}: ${err instanceof Error ? err.message : String(err)}`);
  }
  debugLog("OUT: (ok, SIGTERM sent to %d)", pid);
}

export function getAllPortsFromConfig(config: Config): ConfigPort[] {
  const ports: ConfigPort[] = [];
  for (const svc of config.services) {
    ports.push({ port: svc.local_port, serviceName: svc.name, type: "Direct" });
    if (svc.sql_tap_port !== undefined) {
      ports.push({ port: svc.sql_tap_port, serviceName: `${svc.name} (SQL-Tap)`, type: "Direct" });
    }
    if (svc.sql_tap_http_port !== undefined) {
      ports.push({ port: svc.sql_tap_http_port, serviceName: `${svc.name} (SQL-Tap Web)`, type: "Direct" });
    }
  }
  for (const ps of config.proxy_services) {
    ports.push({ port: ps.local_port, serviceName: ps.name, type: "Proxy" });
    if (ps.sql_tap_port !== undefined) {
      ports.push({ port: ps.sql_tap_port, serviceName: `${ps.name} (SQL-Tap)`, type: "Proxy" });
    }
    if (ps.sql_tap_http_port !== undefined) {
      ports.push({ port: ps.sql_tap_http_port, serviceName: `${ps.name} (SQL-Tap Web)`, type: "Proxy" });
    }
  }
  return ports;
}

export function isKubefwdPid(pid: number, pids: number[]): boolean {
  return pid > 0 && pids.includes(pid);
}

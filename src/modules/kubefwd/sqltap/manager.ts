import type { ChildProcess } from "node:child_process";
import { debugLog, spawnTracked } from "../debug.js";

export type ForwardStatus = "stopped" | "starting" | "running" | "error";

export class SqlTapManager {
  readonly enabled: boolean;
  private child: ChildProcess | null = null;
  private status: ForwardStatus = "stopped";
  private errorMessage = "";
  private stopping = false;

  constructor(
    enabled: boolean,
    private readonly driver: string,
    private readonly listenPort: number,
    private readonly upstreamPort: number,
    readonly grpcPort: number,
    readonly httpPort: number,
  ) {
    this.enabled = enabled;
  }

  get pid(): number {
    return this.child?.pid ?? 0;
  }

  get listenPortValue(): number {
    return this.listenPort;
  }

  private databaseUrl(): string {
    const protocol = this.driver === "postgres" ? "postgresql" : this.driver;
    return `${protocol}://127.0.0.1:${this.upstreamPort}`;
  }

  async start(): Promise<void> {
    if (!this.enabled) return;
    if (this.status === "running" || this.status === "starting") {
      throw new Error("sql-tapd already running");
    }
    this.status = "starting";
    this.errorMessage = "";
    this.stopping = false;

    const args = [
      `--driver=${this.driver}`,
      `--listen=:${this.listenPort}`,
      `--upstream=localhost:${this.upstreamPort}`,
      `--grpc=:${this.grpcPort}`,
    ];
    if (this.httpPort > 0) args.push(`--http=:${this.httpPort}`);

    const databaseUrl = this.databaseUrl();
    debugLog("Starting sql-tapd: DATABASE_URL=%s sql-tapd %s", databaseUrl, args.join(" "));

    const child = spawnTracked("sql-tapd", args, {
      env: { ...process.env, DATABASE_URL: databaseUrl },
    });
    this.child = child;
    let stderr = "";
    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString();
    });

    const started = await new Promise<boolean>((resolve) => {
      const t = setTimeout(() => resolve(true), 500);
      child.once("error", (err) => {
        clearTimeout(t);
        this.status = "error";
        this.errorMessage = `Failed to start sql-tapd: ${err.message}`;
        resolve(false);
      });
      child.once("exit", (code) => {
        clearTimeout(t);
        if (this.status === "starting") {
          this.status = "error";
          this.errorMessage = `sql-tapd exited immediately${stderr.trim() ? ` | stderr: ${stderr.trim()}` : ""} (code ${code})`;
          resolve(false);
        }
      });
    });

    if (!started) {
      throw new Error(this.errorMessage || "sql-tapd failed to start");
    }

    this.status = "running";
    child.on("exit", (code, signal) => {
      if (this.stopping) {
        this.status = "stopped";
        return;
      }
      this.status = "error";
      this.errorMessage = `sql-tapd process exited: code=${code} signal=${signal}`;
      if (stderr.trim()) this.errorMessage += ` | stderr: ${stderr.trim()}`;
      debugLog("EXIT: sql-tapd  stderr=%s", stderr.trim());
    });
  }

  stop(): void {
    if (!this.enabled) return;
    if (this.status !== "running" && this.status !== "starting") return;
    this.stopping = true;
    if (this.child?.pid) {
      try {
        this.child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
      try {
        this.child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
    }
    this.child = null;
    this.status = "stopped";
    this.errorMessage = "";
  }
}

export async function checkSqlTapdAvailable(): Promise<void> {
  const { runCommand } = await import("../debug.js");
  const result = await runCommand("sql-tapd", ["--version"], { timeoutMs: 5000 });
  if (result.status !== 0) {
    throw new Error(`sql-tapd not available: exit ${result.status}\nOutput: ${(result.stdout + result.stderr).trim()}`);
  }
}

export function configNeedsSqlTap(services: { sql_tap_port?: number }[], proxies: { sql_tap_port?: number }[]): boolean {
  return services.some((s) => s.sql_tap_port !== undefined) || proxies.some((s) => s.sql_tap_port !== undefined);
}

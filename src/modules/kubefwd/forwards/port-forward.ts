import type { ChildProcess } from "node:child_process";
import { debugLog, spawnTracked } from "../debug.js";
import type { Service } from "../config/types.js";
import { serviceContext, serviceMaxRetries, serviceNamespace } from "../config/types.js";
import { backoffSeconds, shouldRetry } from "./retry.js";
import { SqlTapManager, type ForwardStatus } from "../sqltap/manager.js";

export interface ForwardSnapshot {
  status: ForwardStatus;
  error: string;
  retrying: boolean;
  retryAttempt: number;
  maxRetries: number;
  pid: number;
}

export class PortForward {
  status: ForwardStatus = "stopped";
  errorMessage = "";
  commandString = "";
  retrying = false;
  retryCount = 0;
  readonly maxRetries: number;
  readonly sqlTap: SqlTapManager;
  private child: ChildProcess | null = null;
  private manualStop = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly kubeContext: string;
  private readonly namespace: string;

  constructor(
    readonly service: Service,
    globalContext: string,
    globalNamespace: string,
    globalMaxRetries: number,
    private readonly onChange: () => void,
  ) {
    this.kubeContext = serviceContext(service, globalContext);
    this.namespace = serviceNamespace(service, globalNamespace);
    this.maxRetries = serviceMaxRetries(service, globalMaxRetries);
    if (service.sql_tap_port !== undefined) {
      this.sqlTap = new SqlTapManager(
        true,
        service.sql_tap_driver ?? "",
        service.sql_tap_port,
        service.local_port,
        service.sql_tap_grpc_port ?? 9091,
        service.sql_tap_http_port ?? 0,
      );
    } else {
      this.sqlTap = new SqlTapManager(false, "", 0, 0, 0, 0);
    }
  }

  snapshot(): ForwardSnapshot {
    return {
      status: this.status,
      error: this.errorMessage,
      retrying: this.retrying,
      retryAttempt: this.retryCount,
      maxRetries: this.maxRetries,
      pid: this.child?.pid ?? 0,
    };
  }

  get pid(): number {
    return this.child?.pid ?? 0;
  }

  isRunning(): boolean {
    return this.status === "running" || this.status === "starting";
  }

  async start(): Promise<void> {
    if (this.status === "running" || this.status === "starting") {
      throw new Error("port forward already running");
    }
    this.clearRetryTimer();
    this.status = "starting";
    this.errorMessage = "";
    this.manualStop = false;
    this.retrying = false;
    this.onChange();

    const portSpec = `${this.service.local_port}:${this.service.remote_port}`;
    const args = [
      `--context=${this.kubeContext}`,
      "-n",
      this.namespace,
      "port-forward",
      `service/${this.service.service_name}`,
      portSpec,
    ];
    this.commandString = `kubectl ${args.join(" ")}`;
    debugLog("Executing: %s", this.commandString);

    const child = spawnTracked("kubectl", args);
    this.child = child;
    let stderr = "";
    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString();
    });

    child.once("error", (err) => {
      this.status = "error";
      this.errorMessage = `Failed to start: ${err.message}`;
      this.onChange();
    });

    child.once("exit", (code, signal) => {
      if (this.manualStop) {
        this.status = "stopped";
        this.child = null;
        this.onChange();
        return;
      }
      debugLog("EXIT: code=%s signal=%s  cmd=%s", code, signal, this.commandString);
      if (this.sqlTap.enabled) this.sqlTap.stop();
      this.child = null;
      if (shouldRetry(this.manualStop, this.retryCount, this.maxRetries)) {
        const wait = backoffSeconds(this.retryCount);
        this.retryCount++;
        this.retrying = true;
        this.status = "error";
        const limit = this.maxRetries === -1 ? "" : `/${this.maxRetries}`;
        this.errorMessage = `Connection lost, retrying in ${wait}s (attempt ${this.retryCount}${this.maxRetries === -1 ? "" : limit})...`;
        if (this.maxRetries === -1) {
          this.errorMessage = `Connection lost, retrying in ${wait}s (attempt ${this.retryCount})...`;
        }
        debugLog("%s: Retrying after %ss (attempt %s)", this.service.name, wait, this.retryCount);
        this.onChange();
        this.retryTimer = setTimeout(() => {
          this.status = "stopped";
          this.start().catch((err: unknown) => {
            this.status = "error";
            this.errorMessage = `Retry failed: ${err instanceof Error ? err.message : String(err)}`;
            this.onChange();
          });
        }, wait * 1000);
      } else {
        this.status = "error";
        this.retrying = false;
        this.errorMessage = `Process exited: code=${code} signal=${signal}`;
        if (stderr.trim()) this.errorMessage += ` | stderr: ${stderr.trim()}`;
        if (this.retryCount > 0) this.errorMessage += ` | Failed after ${this.retryCount} retries`;
        this.errorMessage += ` | Command: ${this.commandString}`;
        this.onChange();
      }
    });

    this.status = "running";
    this.retryCount = 0;
    this.onChange();

    if (this.sqlTap.enabled) {
      await sleep(2000);
      if (this.manualStop || this.status !== "running") return;
      try {
        await this.sqlTap.start();
      } catch (err) {
        debugLog("Failed to start sql-tapd for %s: %s", this.service.name, err);
        this.status = "error";
        this.errorMessage = `sql-tap failed: ${err instanceof Error ? err.message : String(err)}`;
        this.stopProcess();
        this.onChange();
        throw err;
      }
    }
  }

  stop(): void {
    this.manualStop = true;
    this.retrying = false;
    this.clearRetryTimer();
    if (this.sqlTap.enabled) this.sqlTap.stop();
    this.stopProcess();
    this.status = "stopped";
    this.errorMessage = "";
    this.onChange();
  }

  private stopProcess(): void {
    if (this.child?.pid) {
      try {
        this.child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
    }
    this.child = null;
  }

  private clearRetryTimer(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

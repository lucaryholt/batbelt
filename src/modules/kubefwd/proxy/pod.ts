import type { ChildProcess } from "node:child_process";
import { debugLog, runCommand, spawnTracked } from "../debug.js";
import type { ProxyService } from "../config/types.js";
import { serviceMaxRetries } from "../config/types.js";
import { backoffSeconds, shouldRetry } from "../forwards/retry.js";
import { SqlTapManager, type ForwardStatus } from "../sqltap/manager.js";

export type ProxyPodStatus = "not_created" | "creating" | "ready" | "error";

const nonAlphanumRe = /[^a-z0-9]+/g;

export function sanitizePodNameSegment(s: string): string {
  return s.toLowerCase().replace(nonAlphanumRe, "-").replace(/^-+|-+$/g, "");
}

export function buildPodName(baseName: string, podContext: string, podNamespace: string): string {
  const ctx = sanitizePodNameSegment(podContext);
  const ns = sanitizePodNameSegment(podNamespace);
  let name = `${baseName}-${ctx}-${ns}`;
  if (name.length > 63) name = name.slice(0, 63);
  return name.replace(/-+$/g, "");
}

export class ProxyPodManager {
  currentServices: ProxyService[] = [];
  podPorts = new Map<string, number>();
  status: ProxyPodStatus = "not_created";
  errorMessage = "";

  constructor(
    readonly podName: string,
    readonly podImage: string,
    readonly namespace: string,
    readonly context: string,
    private readonly onChange: () => void,
  ) {}

  getActiveServiceNames(): string[] {
    return this.currentServices.map((s) => s.id);
  }

  isServiceActive(id: string): boolean {
    return this.currentServices.some((s) => s.id === id);
  }

  getPodPort(id: string): number | undefined {
    return this.podPorts.get(id);
  }

  async createPodWithServices(selectedServices: ProxyService[]): Promise<void> {
    this.status = "creating";
    this.errorMessage = "";
    this.onChange();

    await this.deletePodUnsafe();

    if (selectedServices.length === 0) {
      this.status = "not_created";
      this.currentServices = [];
      this.podPorts = new Map();
      this.onChange();
      return;
    }

    this.podPorts = new Map();
    selectedServices.forEach((svc, i) => this.podPorts.set(svc.id, 10000 + i));

    const socatCommands = selectedServices.map((svc) => {
      const podPort = this.podPorts.get(svc.id)!;
      return `socat TCP-LISTEN:${podPort},fork,reuseaddr TCP:${svc.target_host}:${svc.target_port} &`;
    });
    socatCommands.push("wait");
    const shellCommand = socatCommands.join(" ");
    debugLog("Creating proxy pod with command: %s", shellCommand);

    const args = [
      `--context=${this.context}`,
      "run",
      "-n",
      this.namespace,
      this.podName,
      `--image=${this.podImage}`,
      "--restart=Never",
      "--command",
      "--",
      "sh",
      "-c",
      shellCommand,
    ];

    let result = await runCommand("kubectl", args, { timeoutMs: 30_000 });
    if (result.status !== 0) {
      const output = result.stdout + result.stderr;
      if (output.includes("AlreadyExists")) {
        debugLog("Pod still exists after deletion attempt, force deleting and retrying...");
        await this.deletePodUnsafe();
        await sleep(3000);
        result = await runCommand("kubectl", args, { timeoutMs: 30_000 });
        if (result.status !== 0) {
          this.status = "error";
          this.errorMessage = `Failed to create pod (retry): exit ${result.status} | ${result.stdout + result.stderr}`;
          this.onChange();
          throw new Error(this.errorMessage);
        }
      } else {
        this.status = "error";
        this.errorMessage = `Failed to create pod: exit ${result.status} | ${output}`;
        this.onChange();
        throw new Error(this.errorMessage);
      }
    }

    try {
      await this.waitForPodReady(60_000);
    } catch (err) {
      this.status = "error";
      this.errorMessage = `Pod failed to become ready: ${err instanceof Error ? err.message : String(err)}`;
      await runCommand("kubectl", [`--context=${this.context}`, "-n", this.namespace, "describe", "pod", this.podName], {
        timeoutMs: 15_000,
      }).catch(() => undefined);
      await runCommand(
        "kubectl",
        [`--context=${this.context}`, "-n", this.namespace, "logs", this.podName, "--all-containers=true"],
        { timeoutMs: 15_000 },
      ).catch(() => undefined);
      this.onChange();
      throw err;
    }

    this.status = "ready";
    this.currentServices = selectedServices;
    this.errorMessage = "";
    this.onChange();
  }

  async deletePod(): Promise<void> {
    await this.deletePodUnsafe();
    this.status = "not_created";
    this.currentServices = [];
    this.podPorts = new Map();
    this.errorMessage = "";
    this.onChange();
  }

  private async checkPodExists(): Promise<{ exists: boolean; ready: boolean }> {
    const result = await runCommand(
      "kubectl",
      [`--context=${this.context}`, "-n", this.namespace, "get", "pod", this.podName, "-o", "json"],
      { timeoutMs: 15_000 },
    );
    const output = result.stdout + result.stderr;
    if (result.status !== 0) {
      if (output.includes("NotFound")) return { exists: false, ready: false };
      throw new Error(`kubectl get pod failed: ${output}`);
    }
    const podData = JSON.parse(result.stdout) as {
      status?: { phase?: string; conditions?: { type: string; status: string }[] };
    };
    if (podData.status?.phase !== "Running") return { exists: true, ready: false };
    const ready = podData.status.conditions?.some((c) => c.type === "Ready" && c.status === "True") ?? false;
    return { exists: true, ready };
  }

  private async deletePodUnsafe(): Promise<void> {
    const result = await runCommand(
      "kubectl",
      [
        `--context=${this.context}`,
        "-n",
        this.namespace,
        "delete",
        "pod",
        this.podName,
        "--ignore-not-found=true",
        "--wait=false",
        "--force",
      ],
      { timeoutMs: 20_000 },
    );
    const output = result.stdout + result.stderr;
    if (result.status !== 0 && !output.includes("NotFound")) {
      throw new Error(`kubectl delete pod failed: ${output}`);
    }

    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const check = await runCommand(
        "kubectl",
        [
          `--context=${this.context}`,
          "-n",
          this.namespace,
          "get",
          "pod",
          this.podName,
          "--ignore-not-found=true",
          "--no-headers",
        ],
        { timeoutMs: 10_000 },
      );
      if (!check.stdout.trim()) {
        debugLog("Pod successfully deleted");
        return;
      }
      debugLog("Waiting for pod deletion... (status: %s)", check.stdout.trim());
      await sleep(1000);
    }

    debugLog("Deletion timeout, attempting final force delete");
    await runCommand(
      "kubectl",
      [
        `--context=${this.context}`,
        "-n",
        this.namespace,
        "delete",
        "pod",
        this.podName,
        "--grace-period=0",
        "--force",
        "--ignore-not-found=true",
      ],
      { timeoutMs: 15_000 },
    );
    await sleep(2000);
  }

  private async waitForPodReady(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const { exists, ready } = await this.checkPodExists();
      if (exists && ready) return;
      await sleep(2000);
    }
    throw new Error("timeout waiting for pod to become ready");
  }
}

export class ProxyForward {
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

  constructor(
    readonly proxyService: ProxyService,
    readonly podManager: ProxyPodManager,
    globalMaxRetries: number,
    private readonly onChange: () => void,
  ) {
    this.maxRetries = serviceMaxRetries(proxyService, globalMaxRetries);
    if (proxyService.sql_tap_port !== undefined) {
      this.sqlTap = new SqlTapManager(
        true,
        proxyService.sql_tap_driver ?? "",
        proxyService.sql_tap_port,
        proxyService.local_port,
        proxyService.sql_tap_grpc_port ?? 9091,
        proxyService.sql_tap_http_port ?? 0,
      );
    } else {
      this.sqlTap = new SqlTapManager(false, "", 0, 0, 0, 0);
    }
  }

  get pid(): number {
    return this.child?.pid ?? 0;
  }

  isRunning(): boolean {
    return this.status === "running" || this.status === "starting";
  }

  async start(): Promise<void> {
    if (this.status === "running" || this.status === "starting") {
      throw new Error("proxy forward already running");
    }
    this.clearRetryTimer();
    const podPort = this.podManager.getPodPort(this.proxyService.id);
    if (podPort === undefined) {
      this.status = "error";
      this.errorMessage = "Service not found in proxy pod";
      this.onChange();
      throw new Error(this.errorMessage);
    }

    this.status = "starting";
    this.errorMessage = "";
    this.manualStop = false;
    this.retrying = false;
    this.onChange();

    const args = [
      `--context=${this.podManager.context}`,
      "-n",
      this.podManager.namespace,
      "port-forward",
      `pod/${this.podManager.podName}`,
      `${this.proxyService.local_port}:${podPort}`,
    ];
    this.commandString = `kubectl ${args.join(" ")}`;
    debugLog("Executing proxy port-forward: %s", this.commandString);

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
      if (this.sqlTap.enabled) this.sqlTap.stop();
      this.child = null;
      if (shouldRetry(this.manualStop, this.retryCount, this.maxRetries)) {
        const wait = backoffSeconds(this.retryCount);
        this.retryCount++;
        this.retrying = true;
        this.status = "error";
        this.errorMessage =
          this.maxRetries === -1
            ? `Connection lost, retrying in ${wait}s (attempt ${this.retryCount})...`
            : `Connection lost, retrying in ${wait}s (attempt ${this.retryCount}/${this.maxRetries})...`;
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
        debugLog("Failed to start sql-tapd for proxy %s: %s", this.proxyService.name, err);
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

// keep runCommandOk imported for potential future use without unused lint - actually I imported it unused. Let me not import it.

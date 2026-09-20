import type { Config, ConfigStore, ProxyService } from "./config/index.js";
import { cloneConfig, proxyGroupKey } from "./config/index.js";
import { PortForward } from "./forwards/port-forward.js";
import { ProxyForward, ProxyPodManager, buildPodName } from "./proxy/pod.js";
import { Explorer } from "./explorer/index.js";
import { getAllPortsFromConfig, getPortUsage, isKubefwdPid, killProcess } from "./ports/checker.js";
import { getDebugLines, isDebugMode } from "./debug.js";
import { validateContext } from "./kubectl.js";
import type { AppState } from "./server/state.js";

export class App {
  config: Config;
  portForwards: PortForward[] = [];
  proxyForwards = new Map<string, ProxyForward>();
  proxyPodManagers = new Map<string, ProxyPodManager>();
  readonly explorer = new Explorer();
  private readonly listeners = new Set<(json: string) => void>();
  private lastJson = "";

  constructor(
    config: Config,
    readonly store: ConfigStore,
  ) {
    this.config = config;
    this.rebuildRuntime();
  }

  subscribe(fn: (json: string) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  notify(): void {
    const json = this.buildStateJson();
    if (json === this.lastJson) return;
    this.lastJson = json;
    for (const fn of this.listeners) {
      try {
        fn(json);
      } catch {
        /* ignore */
      }
    }
  }

  currentStateJson(): string {
    return this.buildStateJson();
  }

  private rebuildRuntime(): void {
    this.portForwards = this.config.services.map(
      (svc) =>
        new PortForward(
          svc,
          this.config.cluster_context,
          this.config.namespace,
          this.config.max_retries,
          () => this.notify(),
        ),
    );
    this.proxyPodManagers = new Map();
    for (const ps of this.config.proxy_services) {
      const key = proxyGroupKey(ps);
      if (!this.proxyPodManagers.has(key)) {
        const podName = buildPodName(this.config.proxy_pod_name, ps.proxy_pod_context, ps.proxy_pod_namespace);
        this.proxyPodManagers.set(
          key,
          new ProxyPodManager(podName, this.config.proxy_pod_image, ps.proxy_pod_namespace, ps.proxy_pod_context, () =>
            this.notify(),
          ),
        );
      }
    }
    this.proxyForwards = new Map();
  }

  async stopAll(): Promise<void> {
    for (const pf of this.portForwards) {
      if (pf.isRunning()) pf.stop();
    }
    for (const pxf of this.proxyForwards.values()) pxf.stop();
    this.proxyForwards.clear();
    await Promise.all([...this.proxyPodManagers.values()].map((mgr) => mgr.deletePod().catch(() => undefined)));
    this.notify();
  }

  reapplyConfig(cfg: Config): void {
    for (const pf of this.portForwards) {
      if (pf.isRunning()) pf.stop();
    }
    for (const pxf of this.proxyForwards.values()) pxf.stop();
    for (const mgr of this.proxyPodManagers.values()) {
      void mgr.deletePod().catch(() => undefined);
    }
    this.config = cfg;
    this.rebuildRuntime();
    this.notify();
  }

  startDefaults(): void {
    for (const pf of this.portForwards) {
      if (pf.service.selected_by_default) void pf.start().catch(() => undefined);
    }
  }

  async startDefaultProxies(): Promise<void> {
    const groups = new Map<string, ProxyService[]>();
    for (const ps of this.config.proxy_services) {
      if (!ps.selected_by_default) continue;
      const key = proxyGroupKey(ps);
      const list = groups.get(key) ?? [];
      list.push(ps);
      groups.set(key, list);
    }
    for (const [key, defSvcs] of groups) {
      const mgr = this.proxyPodManagers.get(key);
      if (!mgr) continue;
      const allSvcs = this.config.proxy_services.filter((ps) => proxyGroupKey(ps) === key);
      try {
        await mgr.createPodWithServices(allSvcs);
        for (const ps of defSvcs) {
          const pxf = new ProxyForward(ps, mgr, this.config.max_retries, () => this.notify());
          void pxf.start().catch(() => undefined);
          this.proxyForwards.set(ps.id, pxf);
        }
      } catch {
        /* pod error is on manager */
      }
    }
    this.notify();
  }

  findForward(id: string): PortForward | undefined {
    return this.portForwards.find((pf) => pf.service.id === id);
  }

  allPids(): number[] {
    const pids: number[] = [];
    for (const pf of this.portForwards) {
      if (pf.pid) pids.push(pf.pid);
      if (pf.sqlTap.pid) pids.push(pf.sqlTap.pid);
    }
    for (const pxf of this.proxyForwards.values()) {
      if (pxf.pid) pids.push(pxf.pid);
      if (pxf.sqlTap.pid) pids.push(pxf.sqlTap.pid);
    }
    return pids;
  }

  async listPorts() {
    const cfgPorts = getAllPortsFromConfig(this.config);
    const pids = this.allPids();
    const result = [];
    for (const cp of cfgPorts) {
      try {
        const usage = await getPortUsage(cp.port);
        let status = usage.status;
        if (usage.inUse && isKubefwdPid(usage.pid, pids)) status = "kubefwd";
        result.push({
          port: cp.port,
          service_name: cp.serviceName,
          type: cp.type,
          in_use: usage.inUse,
          pid: usage.pid || undefined,
          process: usage.processInfo || undefined,
          status,
        });
      } catch {
        result.push({
          port: cp.port,
          service_name: cp.serviceName,
          type: cp.type,
          in_use: false,
          status: "free" as const,
        });
      }
    }
    return result;
  }

  async killPortPid(pid: number): Promise<void> {
    killProcess(pid);
  }

  persistAndReload(mutate: (cfg: Config) => void): Config {
    if (!this.store.writable) {
      throw Object.assign(new Error("configuration is read-only (YAML store)"), { status: 403 });
    }
    const cfg = cloneConfig(this.config);
    mutate(cfg);
    try {
      this.store.save(cfg);
    } catch (err) {
      throw Object.assign(err instanceof Error ? err : new Error(String(err)), { status: 400 });
    }
    const loaded = this.store.load();
    loaded.cluster_context = this.config.cluster_context;
    loaded.cluster_name = this.config.cluster_name;
    this.reapplyConfig(loaded);
    return loaded;
  }

  async switchContext(contextOrName: string): Promise<void> {
    const found = this.config.alternative_contexts.find(
      (c) => c.context === contextOrName || c.name === contextOrName,
    );
    if (!found) {
      throw Object.assign(new Error("context not found in alternative_contexts"), { status: 404 });
    }
    await validateContext(found.context);
    const newConfig = this.store.load();
    newConfig.cluster_context = found.context;
    newConfig.cluster_name = found.name;
    this.reapplyConfig(newConfig);
  }

  reloadFromStore(): void {
    const loaded = this.store.load();
    loaded.cluster_context = this.config.cluster_context;
    this.reapplyConfig(loaded);
  }

  importYamlAndApply(cfg: Config): void {
    this.store.save(cfg);
    const loaded = this.store.load();
    this.reapplyConfig(loaded);
  }

  currentConfigClone(): Config {
    return cloneConfig(this.config);
  }

  private buildStateJson(): string {
    const services = this.portForwards.map((pf) => {
      const snap = pf.snapshot();
      return {
        id: pf.service.id,
        name: pf.service.name,
        tags: pf.service.tags ?? [],
        local_port: pf.service.local_port,
        remote_port: pf.service.remote_port,
        status: snap.status,
        error: snap.error || undefined,
        retrying: snap.retrying,
        retry_attempt: snap.retryAttempt,
        max_retries: snap.maxRetries,
        is_default: pf.service.selected_by_default,
        has_sql_tap: pf.service.sql_tap_port !== undefined,
        sql_tap_port: pf.service.sql_tap_port,
        sql_tap_grpc_port: pf.service.sql_tap_grpc_port,
        sql_tap_http_port: pf.service.sql_tap_http_port,
      };
    });

    const groupOrder: string[] = [];
    const groupSeen = new Set<string>();
    for (const ps of this.config.proxy_services) {
      const key = proxyGroupKey(ps);
      if (!groupSeen.has(key)) {
        groupSeen.add(key);
        groupOrder.push(key);
      }
    }

    const proxy_groups = groupOrder.map((key) => {
      const mgr = this.proxyPodManagers.get(key);
      const lastSlash = key.lastIndexOf("/");
      const context = lastSlash < 0 ? key : key.slice(0, lastSlash);
      const namespace = lastSlash < 0 ? "" : key.slice(lastSlash + 1);
      return {
        group_key: key,
        context,
        namespace,
        pod_status: mgr?.status ?? "not_created",
        pod_error: mgr?.errorMessage || undefined,
        services: this.config.proxy_services
          .filter((ps) => proxyGroupKey(ps) === key)
          .map((ps) => {
            const pxf = this.proxyForwards.get(ps.id);
            return {
              id: ps.id,
              name: ps.name,
              tags: ps.tags ?? [],
              local_port: ps.local_port,
              status: pxf?.status ?? "stopped",
              error: pxf?.errorMessage || undefined,
              retrying: pxf?.retrying ?? false,
              retry_attempt: pxf?.retryCount ?? 0,
              max_retries: pxf?.maxRetries ?? this.config.max_retries,
              is_default: ps.selected_by_default,
              active: this.proxyForwards.has(ps.id),
              proxy_pod_context: ps.proxy_pod_context,
              proxy_pod_namespace: ps.proxy_pod_namespace,
              has_sql_tap: ps.sql_tap_port !== undefined,
              sql_tap_port: ps.sql_tap_port,
              sql_tap_grpc_port: ps.sql_tap_grpc_port,
              sql_tap_http_port: ps.sql_tap_http_port,
            };
          }),
      };
    });

    const src = this.store.description();
    const state: AppState = {
      cluster_context: this.config.cluster_context,
      cluster_name: this.config.cluster_name,
      namespace: this.config.namespace,
      config_source: src,
      config_file: src,
      capabilities: {
        writable: this.store.writable,
        explore: this.store.writable,
      },
      services,
      proxy_groups,
      contexts: this.config.alternative_contexts,
      has_proxy_services: this.config.proxy_services.length > 0,
      debug_mode: isDebugMode(),
      debug_lines: getDebugLines(),
    };
    return JSON.stringify(state);
  }
}

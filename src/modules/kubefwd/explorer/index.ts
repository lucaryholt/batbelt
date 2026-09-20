import { EXPLORER_TIMEOUT_MS } from "../kubectl.js";
import { runCommand, runCommandOk, debugLog } from "../debug.js";
import type { Config } from "../config/types.js";

export interface K8sServicePort {
  name?: string;
  port: number;
  target_port: unknown;
  protocol: string;
}

export interface K8sServiceInfo {
  name: string;
  namespace: string;
  type: string;
  cluster_ip: string;
  ports: K8sServicePort[];
  in_config: boolean;
}

export interface CloudSQLInstance {
  name: string;
  project: string;
  private_ip: string;
  public_ip?: string;
  region: string;
  db_version: string;
  in_config: boolean;
}

export interface MemorystoreInstance {
  name: string;
  host: string;
  port: number;
  region: string;
  tier: string;
  version: string;
  in_config: boolean;
}

export interface GCPProject {
  project_id: string;
  name: string;
}

export interface GCPDiscoveryResult {
  available: boolean;
  project?: string;
  cloudsql?: CloudSQLInstance[];
  memorystore?: MemorystoreInstance[];
  error?: string;
}

export class Explorer {
  private gcloudChecked = false;
  private gcloudAvailable = false;

  async discoverContexts(): Promise<string[]> {
    const out = await runCommandOk("kubectl", ["config", "get-contexts", "-o", "name"], {
      timeoutMs: EXPLORER_TIMEOUT_MS,
    });
    return out
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  }

  async discoverNamespaces(kubeCtx: string): Promise<string[]> {
    const out = await runCommandOk(
      "kubectl",
      ["get", "namespaces", "--context", kubeCtx, "-o", "jsonpath={.items[*].metadata.name}"],
      { timeoutMs: EXPLORER_TIMEOUT_MS },
    );
    return out.trim().split(/\s+/).filter(Boolean);
  }

  async discoverServices(kubeCtx: string, namespace: string, config: Config | null): Promise<K8sServiceInfo[]> {
    const out = await runCommandOk(
      "kubectl",
      ["get", "services", "--context", kubeCtx, "-n", namespace, "-o", "json"],
      { timeoutMs: EXPLORER_TIMEOUT_MS },
    );
    const result = JSON.parse(out) as {
      items: {
        metadata: { name: string; namespace: string };
        spec: {
          type: string;
          clusterIP: string;
          ports?: { name?: string; port: number; targetPort: unknown; protocol: string }[];
        };
      }[];
    };
    const configSvcNames = new Set((config?.services ?? []).map((s) => s.service_name));
    const services: K8sServiceInfo[] = [];
    for (const item of result.items ?? []) {
      if (item.spec.type === "ExternalName") continue;
      services.push({
        name: item.metadata.name,
        namespace: item.metadata.namespace,
        type: item.spec.type,
        cluster_ip: item.spec.clusterIP,
        ports: (item.spec.ports ?? []).map((p) => ({
          name: p.name,
          port: p.port,
          target_port: p.targetPort,
          protocol: p.protocol,
        })),
        in_config: configSvcNames.has(item.metadata.name),
      });
    }
    return services;
  }

  async isGcloudAvailable(): Promise<boolean> {
    if (!this.gcloudChecked) {
      this.gcloudChecked = true;
      const result = await runCommand("gcloud", ["version"], { timeoutMs: EXPLORER_TIMEOUT_MS });
      this.gcloudAvailable = result.status === 0;
      if (this.gcloudAvailable) debugLog("gcloud CLI detected");
      else debugLog("gcloud CLI not available");
    }
    return this.gcloudAvailable;
  }

  async getGCPProject(): Promise<string> {
    try {
      const out = await runCommandOk("gcloud", ["config", "get-value", "project"], { timeoutMs: EXPLORER_TIMEOUT_MS });
      return out.trim();
    } catch {
      return "";
    }
  }

  async discoverGCPProjects(): Promise<{ projects: GCPProject[]; active: string }> {
    if (!(await this.isGcloudAvailable())) {
      throw new Error("gcloud CLI not available");
    }
    const active = await this.getGCPProject();
    const out = await runCommandOk("gcloud", ["projects", "list", "--format=json(projectId,name)", "--sort-by=name"], {
      timeoutMs: EXPLORER_TIMEOUT_MS,
    });
    const raw = JSON.parse(out) as { projectId: string; name: string }[];
    return {
      projects: raw.map((r) => ({ project_id: r.projectId, name: r.name })),
      active,
    };
  }

  async discoverGCP(project: string, config: Config | null): Promise<GCPDiscoveryResult> {
    if (!(await this.isGcloudAvailable())) {
      return { available: false };
    }
    if (!project) project = await this.getGCPProject();
    const proxyHosts = new Set((config?.proxy_services ?? []).map((ps) => ps.target_host));

    const [sql, redis] = await Promise.allSettled([
      this.discoverCloudSQL(project, proxyHosts),
      this.discoverMemorystore(project, proxyHosts),
    ]);

    const result: GCPDiscoveryResult = {
      available: true,
      project,
      cloudsql: sql.status === "fulfilled" ? sql.value : [],
      memorystore: redis.status === "fulfilled" ? redis.value : [],
    };
    const errs: string[] = [];
    if (sql.status === "rejected") errs.push(`Cloud SQL: ${sql.reason}`);
    if (redis.status === "rejected") errs.push(`Memorystore: ${redis.reason}`);
    if (errs.length) result.error = errs.join("; ");
    return result;
  }

  private async discoverCloudSQL(project: string, proxyHosts: Set<string>): Promise<CloudSQLInstance[]> {
    const args = ["sql", "instances", "list", "--format=json"];
    if (project) args.push(`--project=${project}`);
    const out = await runCommandOk("gcloud", args, { timeoutMs: EXPLORER_TIMEOUT_MS });
    const raw = JSON.parse(out) as {
      name: string;
      project: string;
      region: string;
      databaseVersion: string;
      ipAddresses?: { type: string; ipAddress: string }[];
    }[];
    return raw.map((r) => {
      const inst: CloudSQLInstance = {
        name: r.name,
        project: r.project || project,
        private_ip: "",
        region: r.region,
        db_version: r.databaseVersion,
        in_config: false,
      };
      for (const ip of r.ipAddresses ?? []) {
        if (ip.type === "PRIVATE") inst.private_ip = ip.ipAddress;
        if (ip.type === "PRIMARY") inst.public_ip = ip.ipAddress;
      }
      if (inst.private_ip) inst.in_config = proxyHosts.has(inst.private_ip);
      return inst;
    });
  }

  private async discoverMemorystore(project: string, proxyHosts: Set<string>): Promise<MemorystoreInstance[]> {
    const args = ["redis", "instances", "list", "--region=-", "--format=json"];
    if (project) args.push(`--project=${project}`);
    const out = await runCommandOk("gcloud", args, { timeoutMs: EXPLORER_TIMEOUT_MS });
    const raw = JSON.parse(out) as {
      name: string;
      host: string;
      port: number;
      locationId?: string;
      currentLocationId?: string;
      tier: string;
      redisVersion: string;
    }[];
    return raw.map((r) => {
      let name = r.name;
      const idx = name.lastIndexOf("/");
      if (idx >= 0) name = name.slice(idx + 1);
      const inst: MemorystoreInstance = {
        name,
        host: r.host,
        port: r.port,
        region: r.locationId || r.currentLocationId || "",
        tier: r.tier,
        version: r.redisVersion,
        in_config: r.host ? proxyHosts.has(r.host) : false,
      };
      return inst;
    });
  }
}

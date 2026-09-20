import type { GCPDiscoveryResult, GCPProject, K8sServiceInfo, PortInfo, ProxyServiceConfig, ServiceConfig } from "./types";

async function req(method: string, path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (data as { error?: string }).error || res.statusText;
    throw new Error(err);
  }
  return data;
}

const enc = encodeURIComponent;

export const api = {
  startAll: () => req("POST", "/api/kubefwd/services/start-all"),
  stopAll: () => req("POST", "/api/kubefwd/services/stop-all"),
  startDefaults: () => req("POST", "/api/kubefwd/services/start-defaults"),
  startService: (id: string) => req("POST", `/api/kubefwd/services/${enc(id)}/start`),
  stopService: (id: string) => req("POST", `/api/kubefwd/services/${enc(id)}/stop`),

  startProxyPod: (group_key: string) => req("POST", "/api/kubefwd/proxy-services/start-pod", { group_key }),
  startDefaultProxies: () => req("POST", "/api/kubefwd/proxy-services/start-defaults"),
  startProxyService: (id: string) => req("POST", `/api/kubefwd/proxy-services/${enc(id)}/start`),
  stopProxyService: (id: string) => req("POST", `/api/kubefwd/proxy-services/${enc(id)}/stop`),
  resetProxy: () => req("POST", "/api/kubefwd/proxy-services/reset"),
  killPod: (group_key: string) => req("POST", "/api/kubefwd/proxy-services/kill-pod", { group_key }),

  switchContext: (context: string) => req("POST", "/api/kubefwd/contexts/switch", { context }),

  getPorts: () => req("GET", "/api/kubefwd/ports") as Promise<PortInfo[]>,
  killPort: (port: number) => req("POST", `/api/kubefwd/ports/${port}/kill`),

  reloadConfig: () => req("POST", "/api/kubefwd/config/reload"),
  importYaml: (yaml: string) => req("POST", "/api/kubefwd/config/import-yaml", { yaml }),

  getService: (id: string) => req("GET", `/api/kubefwd/config/services/${enc(id)}`) as Promise<ServiceConfig>,
  addService: (sv: ServiceConfig) => req("POST", "/api/kubefwd/config/services", sv),
  updateService: (id: string, sv: ServiceConfig) => req("PUT", `/api/kubefwd/config/services/${enc(id)}`, sv),
  deleteService: (id: string) => req("DELETE", `/api/kubefwd/config/services/${enc(id)}`),

  getProxyService: (id: string) =>
    req("GET", `/api/kubefwd/config/proxy-services/${enc(id)}`) as Promise<ProxyServiceConfig>,
  addProxyService: (ps: ProxyServiceConfig) => req("POST", "/api/kubefwd/config/proxy-services", ps),
  updateProxyService: (id: string, ps: ProxyServiceConfig) =>
    req("PUT", `/api/kubefwd/config/proxy-services/${enc(id)}`, ps),
  deleteProxyService: (id: string) => req("DELETE", `/api/kubefwd/config/proxy-services/${enc(id)}`),

  explorerContexts: () => req("GET", "/api/kubefwd/explorer/contexts") as Promise<string[]>,
  explorerNamespaces: (context: string) =>
    req("GET", `/api/kubefwd/explorer/namespaces?context=${enc(context)}`) as Promise<string[]>,
  explorerServices: (context: string, namespace: string) =>
    req("GET", `/api/kubefwd/explorer/services?context=${enc(context)}&namespace=${enc(namespace)}`) as Promise<K8sServiceInfo[]>,
  explorerGcpProjects: () =>
    req("GET", "/api/kubefwd/explorer/gcp/projects") as Promise<{ projects: GCPProject[]; active: string }>,
  explorerGcp: (project: string) =>
    req("GET", `/api/kubefwd/explorer/gcp?project=${enc(project)}`) as Promise<GCPDiscoveryResult>,
};

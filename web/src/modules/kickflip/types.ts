export interface ClusterContext {
  name: string;
  context: string;
  default?: boolean;
}

export interface ServiceConfig {
  name: string;
  external_secret?: string;
  deployment?: string;
}

export interface NamespaceConfig {
  name: string;
  services: ServiceConfig[];
}

export interface ConfigResponse {
  contexts: ClusterContext[];
  namespaces: NamespaceConfig[];
  defaultContext: string;
}

export interface HealthResponse {
  kubectlAvailable: boolean;
  kubectlVersion?: string;
}

export type RunMode = "restart" | "secrets-restart";

export interface RunServiceRef {
  namespace: string;
  name: string;
}

export type RunEvent =
  | { type: "log"; line: string }
  | { type: "service"; namespace: string; name: string; ok: boolean; error?: string }
  | { type: "done" }
  | { type: "error"; error: string };

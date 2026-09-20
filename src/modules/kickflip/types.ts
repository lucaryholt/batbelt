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

export interface KickflipConfig {
  contexts: ClusterContext[];
  namespaces: NamespaceConfig[];
}

export interface ResolvedService {
  name: string;
  namespace: string;
  externalSecret: string;
  deployment: string;
}

export type RunMode = "restart" | "secrets-restart";

export interface RunServiceRef {
  namespace: string;
  name: string;
}

export interface RunRequest {
  context: string;
  mode: RunMode;
  services: RunServiceRef[];
  confirm?: boolean;
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

export interface KubectlResult {
  ok: boolean;
  code: number;
  stdout: string;
  stderr: string;
}

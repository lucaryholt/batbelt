export interface Capabilities {
  writable: boolean;
  explore: boolean;
}

export interface ServiceState {
  id: string;
  name: string;
  tags: string[];
  local_port: number;
  remote_port: number;
  status: string;
  error?: string;
  retrying: boolean;
  retry_attempt: number;
  max_retries: number;
  is_default: boolean;
  has_sql_tap: boolean;
  sql_tap_port?: number;
  sql_tap_grpc_port?: number;
  sql_tap_http_port?: number;
}

export interface ProxyServiceState {
  id: string;
  name: string;
  tags: string[];
  local_port: number;
  status: string;
  error?: string;
  retrying?: boolean;
  retry_attempt?: number;
  max_retries?: number;
  is_default: boolean;
  active: boolean;
  proxy_pod_context: string;
  proxy_pod_namespace: string;
  has_sql_tap: boolean;
  sql_tap_port?: number;
  sql_tap_grpc_port?: number;
  sql_tap_http_port?: number;
}

export interface ProxyGroupState {
  group_key: string;
  context: string;
  namespace: string;
  pod_status: string;
  pod_error?: string;
  services: ProxyServiceState[];
}

export interface AppState {
  cluster_context: string;
  cluster_name: string;
  namespace: string;
  config_source: string;
  config_file: string;
  capabilities: Capabilities;
  services: ServiceState[];
  proxy_groups: ProxyGroupState[];
  contexts: { name: string; context: string }[];
  has_proxy_services: boolean;
  debug_mode: boolean;
  debug_lines: string[];
}

export interface PortInfo {
  port: number;
  service_name: string;
  type: string;
  in_use: boolean;
  pid?: number;
  process?: string;
  status: string;
}

export interface ServiceConfig {
  id?: string;
  name: string;
  tags?: string[];
  service_name: string;
  remote_port: number;
  local_port: number;
  selected_by_default: boolean;
  context?: string;
  namespace?: string;
  max_retries?: number;
  sql_tap_port?: number;
  sql_tap_driver?: string;
  sql_tap_grpc_port?: number;
  sql_tap_http_port?: number;
}

export interface ProxyServiceConfig {
  id?: string;
  name: string;
  tags?: string[];
  target_host: string;
  target_port: number;
  local_port: number;
  selected_by_default: boolean;
  proxy_pod_context: string;
  proxy_pod_namespace: string;
  max_retries?: number;
  sql_tap_port?: number;
  sql_tap_driver?: string;
  sql_tap_grpc_port?: number;
  sql_tap_http_port?: number;
}

export interface K8sServiceInfo {
  name: string;
  namespace: string;
  type: string;
  cluster_ip: string;
  ports: { name?: string; port: number; protocol: string }[];
  in_config: boolean;
}

export interface GCPProject {
  project_id: string;
  name: string;
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

export interface GCPDiscoveryResult {
  available: boolean;
  project?: string;
  cloudsql?: CloudSQLInstance[];
  memorystore?: MemorystoreInstance[];
  error?: string;
}

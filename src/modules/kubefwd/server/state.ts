export interface AppState {
  cluster_context: string;
  cluster_name: string;
  namespace: string;
  config_source: string;
  config_file: string;
  capabilities: { writable: boolean; explore: boolean };
  services: ServiceState[];
  proxy_groups: ProxyGroupState[];
  contexts: { name: string; context: string }[];
  has_proxy_services: boolean;
  debug_mode: boolean;
  debug_lines: string[];
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

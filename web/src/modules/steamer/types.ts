export interface Environment {
  name: string;
  addr: string;
  namespace?: string;
  oidcMount?: string;
  oidcRole?: string;
  kvMount?: string;
}

export interface AppConfig {
  environments: Environment[];
}

export interface EnvStatus {
  name: string;
  addr: string;
  loggedIn: boolean;
  ttl?: number;
  displayName?: string;
  error?: string;
}

export interface SecretData {
  [key: string]: string;
}

export interface EnvResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
  missing?: boolean;
}

export interface CompareResponse {
  results: Record<string, EnvResult<SecretData>>;
}

export interface ListResponse {
  results: Record<string, EnvResult<string[]>>;
}

export interface ExistsResponse {
  exists: Record<string, boolean>;
}

export interface WriteRequest {
  mount: string;
  path: string;
  values: Record<string, SecretData>;
  confirm?: boolean;
}

export interface WriteResponse {
  results: Record<string, EnvResult<{ version?: number }>>;
}

export interface HealthResponse {
  baoAvailable: boolean;
  baoVersion?: string;
}

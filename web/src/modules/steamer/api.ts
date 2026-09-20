import type {
  AppConfig,
  CompareResponse,
  EnvStatus,
  ExistsResponse,
  HealthResponse,
  ListResponse,
  SecretData,
  WriteResponse,
} from "./types";

async function parseJson<T>(res: Response): Promise<T> {
  const body = (await res.json()) as T & { error?: string };
  if (!res.ok) {
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return body;
}

export async function getHealth(): Promise<HealthResponse> {
  return parseJson(await fetch("/api/steamer/health"));
}

export async function getConfig(): Promise<AppConfig> {
  return parseJson(await fetch("/api/steamer/config"));
}

export async function saveConfig(config: AppConfig): Promise<AppConfig> {
  return parseJson(
    await fetch("/api/steamer/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    }),
  );
}

export async function getStatus(): Promise<{ environments: EnvStatus[] }> {
  return parseJson(await fetch("/api/steamer/status"));
}

export async function logoutEnv(name: string): Promise<void> {
  await parseJson(await fetch(`/api/steamer/envs/${encodeURIComponent(name)}/logout`, { method: "POST" }));
}

export function loginEnv(
  name: string,
  onEvent: (event: { type: string; line?: string; error?: string }) => void,
): { close: () => void; done: Promise<void> } {
  const source = new EventSource(`/api/steamer/envs/${encodeURIComponent(name)}/login`);
  let resolveDone: () => void;
  let rejectDone: (err: Error) => void;
  const done = new Promise<void>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });
  source.onmessage = (message) => {
    const event = JSON.parse(message.data) as { type: string; line?: string; error?: string };
    onEvent(event);
    if (event.type === "done") {
      source.close();
      resolveDone();
    } else if (event.type === "error") {
      source.close();
      rejectDone(new Error(event.error || "Login failed"));
    }
  };
  source.onerror = () => {
    source.close();
    rejectDone(new Error("Login connection closed"));
  };
  return {
    close: () => {
      source.close();
      resolveDone();
    },
    done,
  };
}

export async function getSecrets(mount: string, path: string): Promise<CompareResponse> {
  const params = new URLSearchParams({ mount, path });
  return parseJson(await fetch(`/api/steamer/secrets?${params}`));
}

export async function listSecrets(mount: string, path: string): Promise<ListResponse> {
  const params = new URLSearchParams({ mount, path });
  return parseJson(await fetch(`/api/steamer/secrets/list?${params}`));
}

export async function checkExists(
  mount: string,
  path: string,
  envNames: string[],
): Promise<ExistsResponse> {
  return parseJson(
    await fetch("/api/steamer/secrets/exists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mount, path, envNames }),
    }),
  );
}

export async function writeSecrets(input: {
  mount: string;
  path: string;
  values: Record<string, SecretData>;
  confirm?: boolean;
}): Promise<WriteResponse> {
  return parseJson(
    await fetch("/api/steamer/secrets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
}

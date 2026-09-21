import type { HomepageConfig } from "./types";

async function parseJson<T>(res: Response): Promise<T> {
  const body = (await res.json()) as T & { error?: string };
  if (!res.ok) {
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return body;
}

export async function getConfig(): Promise<HomepageConfig> {
  return parseJson(await fetch("/api/homepage/config"));
}

export async function saveConfig(config: HomepageConfig): Promise<HomepageConfig> {
  return parseJson(
    await fetch("/api/homepage/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    }),
  );
}

export async function openConfig(): Promise<{ path: string }> {
  return parseJson(
    await fetch("/api/homepage/config/open", {
      method: "POST",
    }),
  );
}

import { coerceConfig, type HomepageConfig, type ToolsStatus } from "./types";

async function parseJson<T>(res: Response): Promise<T> {
  const body = (await res.json()) as T & { error?: string };
  if (!res.ok) {
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return body;
}

export async function getConfig(): Promise<HomepageConfig> {
  return coerceConfig(await parseJson(await fetch("/api/homepage/config")));
}

export async function saveConfig(config: HomepageConfig): Promise<HomepageConfig> {
  return coerceConfig(
    await parseJson(
      await fetch("/api/homepage/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      }),
    ),
  );
}

export async function openConfig(): Promise<{ path: string }> {
  return parseJson(
    await fetch("/api/homepage/config/open", {
      method: "POST",
    }),
  );
}

export async function getTools(): Promise<ToolsStatus> {
  return parseJson(await fetch("/api/homepage/tools"));
}

export async function openDirectory(id: string): Promise<{ path: string; fallback?: "kitty-window" }> {
  return parseJson(
    await fetch("/api/homepage/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    }),
  );
}

import type { ConfigResponse, HealthResponse, InboxResponse } from "./types";

async function parseJson<T>(res: Response): Promise<T> {
  const body = (await res.json()) as T & { error?: string };
  if (!res.ok) {
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return body;
}

export async function getHealth(): Promise<HealthResponse> {
  return parseJson(await fetch("/api/prlooker/health"));
}

export async function getConfig(): Promise<ConfigResponse> {
  return parseJson(await fetch("/api/prlooker/config"));
}

export async function reloadConfig(): Promise<ConfigResponse> {
  return parseJson(
    await fetch("/api/prlooker/config/reload", {
      method: "POST",
    }),
  );
}

export async function openConfig(): Promise<{ path: string }> {
  return parseJson(
    await fetch("/api/prlooker/config/open", {
      method: "POST",
    }),
  );
}

export async function getInbox(): Promise<InboxResponse> {
  return parseJson(await fetch("/api/prlooker/inbox"));
}

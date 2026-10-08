import type { ModulesResponse, UpdateStatus } from "./types";

async function json<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

export const hostApi = {
  getModules: () => json<ModulesResponse>("/api/modules"),
  getHealth: () => json<{ ok: boolean; host: string }>("/api/health"),
  getUpdate: () => json<UpdateStatus>("/api/update"),
};

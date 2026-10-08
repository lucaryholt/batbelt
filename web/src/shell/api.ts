import type { ModuleAction, ModulesResponse, UpdateStatus } from "./types";

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
  runAction: async (action: ModuleAction): Promise<void> => {
    if (action.method !== "POST" || !action.path.startsWith("/api/")) {
      throw new Error("Invalid Batbelt action");
    }
    const res = await fetch(action.path, { method: action.method });
    if (!res.ok) {
      const data = await res.json().catch(() => null) as { error?: string } | null;
      throw new Error(data?.error || `${res.status} ${res.statusText}`);
    }
  },
};

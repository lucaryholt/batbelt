import type { ConfigResponse, HealthResponse, RunEvent, RunMode, RunServiceRef } from "./types";

async function parseJson<T>(res: Response): Promise<T> {
  const body = (await res.json()) as T & { error?: string };
  if (!res.ok) {
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return body;
}

export async function getHealth(): Promise<HealthResponse> {
  return parseJson(await fetch("/api/kickflip/health"));
}

export async function getConfig(): Promise<ConfigResponse> {
  return parseJson(await fetch("/api/kickflip/config"));
}

export async function reloadConfig(): Promise<ConfigResponse> {
  return parseJson(
    await fetch("/api/kickflip/config/reload", {
      method: "POST",
    }),
  );
}

async function readSse(res: Response, onEvent: (event: RunEvent) => void): Promise<void> {
  if (!res.body) throw new Error("No response body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop() ?? "";
    for (const part of parts) {
      for (const line of part.split("\n")) {
        if (!line.startsWith("data:")) continue;
        onEvent(JSON.parse(line.slice(5).trim()) as RunEvent);
      }
    }
  }
}

export async function runKickflip(
  input: {
    context: string;
    mode: RunMode;
    services: RunServiceRef[];
    confirm: true;
  },
  onEvent: (event: RunEvent) => void,
): Promise<void> {
  const res = await fetch("/api/kickflip/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const type = res.headers.get("content-type") ?? "";
  if (!type.includes("text/event-stream")) {
    const body = (await res.json()) as { error?: string };
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  await readSse(res, onEvent);
}

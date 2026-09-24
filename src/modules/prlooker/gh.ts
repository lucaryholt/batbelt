import { spawn } from "node:child_process";
import type {
  GhResult,
  HealthResponse,
  InboxItem,
  InboxReason,
  InboxResponse,
  PrlookerConfig,
} from "./types.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const HEALTH_TIMEOUT_MS = 15_000;
export const SEARCH_LIMIT = "50";
export const JSON_FIELDS =
  "number,title,url,repository,author,createdAt,updatedAt,isDraft,labels";

export type RunGh = (args: string[], options?: { timeoutMs?: number }) => Promise<GhResult>;

function isEnoent(err: unknown): boolean {
  return (err as NodeJS.ErrnoException).code === "ENOENT";
}

export function runGh(args: string[], options: { timeoutMs?: number } = {}): Promise<GhResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("gh", args, {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    child.on("error", (err) => {
      clearTimeout(timer);
      if (isEnoent(err)) {
        reject(new Error("`gh` was not found on PATH. Install the GitHub CLI."));
        return;
      }
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`gh ${args.join(" ")} timed out`));
        return;
      }
      const status = code ?? 1;
      resolve({ ok: status === 0, code: status, stdout, stderr });
    });
  });
}

export function searchPrsArgs(filter: string[]): string[] {
  return ["search", "prs", ...filter, "--state=open", "--limit", SEARCH_LIMIT, "--json", JSON_FIELDS];
}

function repoName(repo: unknown): string {
  if (typeof repo === "string") return repo;
  if (repo && typeof repo === "object") {
    const row = repo as Record<string, unknown>;
    return String(row.nameWithOwner ?? row.name ?? "");
  }
  return "";
}

function authorLogin(author: unknown): string {
  if (typeof author === "string") return author;
  if (author && typeof author === "object") {
    return String((author as Record<string, unknown>).login ?? "");
  }
  return "";
}

function labelNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object") return String((item as Record<string, unknown>).name ?? "");
      return "";
    })
    .filter(Boolean);
}

export function parseSearchItems(stdout: string, reason: InboxReason): InboxItem[] {
  const text = stdout.trim();
  if (!text) return [];
  const raw = JSON.parse(text) as unknown;
  if (!Array.isArray(raw)) throw new Error("gh search prs returned a non-array");
  return raw.map((item) => {
    const row = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    return {
      number: Number(row.number ?? 0),
      title: String(row.title ?? ""),
      url: String(row.url ?? ""),
      repository: repoName(row.repository),
      author: authorLogin(row.author),
      createdAt: String(row.createdAt ?? ""),
      updatedAt: String(row.updatedAt ?? ""),
      isDraft: row.isDraft === true,
      labels: labelNames(row.labels),
      reasons: [reason],
    };
  });
}

export function mergeInboxItems(groups: InboxItem[][]): InboxItem[] {
  const byUrl = new Map<string, InboxItem>();
  for (const group of groups) {
    for (const item of group) {
      if (!item.url) continue;
      const existing = byUrl.get(item.url);
      if (!existing) {
        byUrl.set(item.url, { ...item, reasons: [...item.reasons] });
        continue;
      }
      for (const reason of item.reasons) {
        if (!existing.reasons.includes(reason)) existing.reasons.push(reason);
      }
    }
  }
  return [...byUrl.values()].sort((a, b) => {
    const at = Date.parse(a.updatedAt) || 0;
    const bt = Date.parse(b.updatedAt) || 0;
    return bt - at;
  });
}

function failMessage(result: GhResult, label: string): string {
  return (result.stderr || result.stdout || `${label} failed (exit ${result.code})`).trim();
}

export async function ghHealth(run: RunGh = runGh): Promise<HealthResponse> {
  try {
    const result = await run(["api", "user"], { timeoutMs: HEALTH_TIMEOUT_MS });
    if (!result.ok) return { ghAvailable: true, loggedIn: false };
    const body = JSON.parse(result.stdout || "{}") as { login?: string };
    const login = String(body.login ?? "").trim();
    return login
      ? { ghAvailable: true, loggedIn: true, login }
      : { ghAvailable: true, loggedIn: true };
  } catch (err) {
    if (isEnoent(err) || /`gh` was not found/i.test((err as Error).message)) {
      return { ghAvailable: false, loggedIn: false };
    }
    return { ghAvailable: false, loggedIn: false };
  }
}

export async function fetchInbox(
  config: PrlookerConfig,
  run: RunGh = runGh,
): Promise<InboxResponse> {
  const searches: { reason: InboxReason; args: string[] }[] = [
    { reason: "review", args: searchPrsArgs(["--review-requested=@me"]) },
    { reason: "assigned", args: searchPrsArgs(["--assignee=@me"]) },
    { reason: "authored", args: searchPrsArgs(["--author=@me"]) },
    { reason: "mentioned", args: searchPrsArgs(["--mentions=@me"]) },
    ...config.teams.map((team) => ({
      reason: "team" as const,
      args: searchPrsArgs([`--review-requested=${team}`]),
    })),
  ];

  const results = await Promise.all(searches.map((item) => run(item.args)));
  const groups: InboxItem[][] = [];
  for (let i = 0; i < searches.length; i++) {
    const result = results[i];
    if (!result.ok) throw new Error(failMessage(result, `gh ${searches[i].args.join(" ")}`));
    groups.push(parseSearchItems(result.stdout, searches[i].reason));
  }

  let viewer: string | undefined;
  try {
    const user = await run(["api", "user"], { timeoutMs: HEALTH_TIMEOUT_MS });
    if (user.ok) {
      const body = JSON.parse(user.stdout || "{}") as { login?: string };
      const login = String(body.login ?? "").trim();
      if (login) viewer = login;
    }
  } catch {
    /* inbox still useful without viewer */
  }

  return {
    viewer,
    fetchedAt: new Date().toISOString(),
    items: mergeInboxItems(groups),
  };
}

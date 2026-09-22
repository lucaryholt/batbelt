import { access, chmod, readFile, writeFile } from "node:fs/promises";
import { parse, stringify } from "yaml";
import type { PrlookerConfig } from "./types.js";
import { configFilePath, ensureAppDirs } from "./paths.js";

export const DEFAULT_POLL_SECONDS = 60;
export const MIN_POLL_SECONDS = 30;

export const emptyConfig = (): PrlookerConfig => ({
  pollSeconds: DEFAULT_POLL_SECONDS,
  teams: [],
});

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value as Record<string, unknown>;
}

function normalizeTeam(raw: unknown, index: number): string {
  const value = String(raw ?? "").trim();
  const match = /^([^/\s]+)\/([^/\s]+)$/.exec(value);
  if (!match) throw new Error(`teams[${index}] must be org/team`);
  return `${match[1]}/${match[2]}`;
}

export function normalizeConfig(raw: unknown): PrlookerConfig {
  if (raw == null || raw === "") return emptyConfig();
  const row = asRecord(raw, "PR Looker config");
  let pollSeconds = DEFAULT_POLL_SECONDS;
  if (row.pollSeconds != null && row.pollSeconds !== "") {
    const n = Number(row.pollSeconds);
    if (!Number.isInteger(n) || n < MIN_POLL_SECONDS) {
      throw new Error(`pollSeconds must be an integer >= ${MIN_POLL_SECONDS}`);
    }
    pollSeconds = n;
  }
  const seen = new Set<string>();
  const teams: string[] = [];
  const list = Array.isArray(row.teams) ? row.teams : [];
  list.forEach((item, i) => {
    const team = normalizeTeam(item, i);
    if (seen.has(team)) return;
    seen.add(team);
    teams.push(team);
  });
  return { pollSeconds, teams };
}

export async function writeEmptyIfMissing(): Promise<boolean> {
  await ensureAppDirs();
  try {
    await access(configFilePath());
    return false;
  } catch {
    await saveConfig(emptyConfig());
    return true;
  }
}

export async function loadConfig(): Promise<PrlookerConfig> {
  await ensureAppDirs();
  try {
    const text = await readFile(configFilePath(), "utf8");
    if (!text.trim()) return emptyConfig();
    return normalizeConfig(parse(text));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return emptyConfig();
    throw err;
  }
}

export async function saveConfig(config: PrlookerConfig): Promise<PrlookerConfig> {
  const normalized = normalizeConfig(config);
  await ensureAppDirs();
  const body = stringify(normalized);
  await writeFile(configFilePath(), body, { mode: 0o600 });
  await chmod(configFilePath(), 0o600);
  return normalized;
}

const STORAGE_KEY = "batbelt.homepage.usage.v1";
const VERSION = 1;
export const MAX_USAGE_ENTRIES = 500;
export const MAX_USAGE_COUNT = 1_000_000;

export interface UsageStore {
  version: 1;
  counts: Record<string, number>;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function validCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

export function parseUsage(raw: string | null): UsageStore {
  if (!raw) return { version: VERSION, counts: {} };
  try {
    const value = JSON.parse(raw) as { version?: unknown; counts?: unknown };
    if (value.version !== VERSION || !value.counts || typeof value.counts !== "object") {
      return { version: VERSION, counts: {} };
    }
    const entries = Object.entries(value.counts)
      .filter(([key, count]) => key.length > 0 && validCount(count))
      .slice(-MAX_USAGE_ENTRIES)
      .map(([key, count]) => [key, Math.min(count as number, MAX_USAGE_COUNT)] as const);
    return { version: VERSION, counts: Object.fromEntries(entries) };
  } catch {
    return { version: VERSION, counts: {} };
  }
}

function browserStorage(): StorageLike | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function loadUsage(storage: StorageLike | undefined = browserStorage()): UsageStore {
  if (!storage) return { version: VERSION, counts: {} };
  try {
    return parseUsage(storage.getItem(STORAGE_KEY));
  } catch {
    return { version: VERSION, counts: {} };
  }
}

export function recordUsage(
  current: UsageStore,
  key: string,
  storage: StorageLike | undefined = browserStorage(),
): UsageStore {
  const count = Math.min((current.counts[key] ?? 0) + 1, MAX_USAGE_COUNT);
  const counts = { ...current.counts };
  delete counts[key];
  counts[key] = count;
  const entries = Object.entries(counts).slice(-MAX_USAGE_ENTRIES);
  const next: UsageStore = { version: VERSION, counts: Object.fromEntries(entries) };
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ranking remains available for the current session when storage is unavailable.
  }
  return next;
}

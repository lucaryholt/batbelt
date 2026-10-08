export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const UPDATE_CHECK_TIMEOUT_MS = 5_000;
const RELEASE_API_URL = "https://api.github.com/repos/lucaryholt/batbelt/releases/latest";

export interface ReleaseUpdate {
  version: string;
  url: string;
  publishedAt: string | null;
}

export interface UpdateStatus {
  currentVersion: string;
  update: ReleaseUpdate | null;
}

interface GitHubRelease {
  tag_name: string;
  html_url: string;
  published_at?: string | null;
}

export type ReleaseFetcher = () => Promise<unknown>;

function parseVersion(value: string): [number, number, number] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(value);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

export function isNewerVersion(candidate: string, current: string): boolean {
  const left = parseVersion(candidate);
  const right = parseVersion(current);
  if (!left || !right) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index];
  }
  return false;
}

function parseRelease(value: unknown): GitHubRelease | null {
  if (!value || typeof value !== "object") return null;
  const release = value as Record<string, unknown>;
  if (typeof release.tag_name !== "string" || typeof release.html_url !== "string") return null;
  let url: URL;
  try {
    url = new URL(release.html_url);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname !== "github.com") return null;
  if (release.published_at !== undefined && release.published_at !== null && typeof release.published_at !== "string") {
    return null;
  }
  return {
    tag_name: release.tag_name,
    html_url: url.toString(),
    published_at: release.published_at as string | null | undefined,
  };
}

export async function fetchLatestRelease(): Promise<unknown> {
  const response = await fetch(RELEASE_API_URL, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "batbelt-update-check",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    signal: AbortSignal.timeout(UPDATE_CHECK_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`GitHub release request failed: ${response.status}`);
  return response.json();
}

export class UpdateChecker {
  private cached: UpdateStatus;
  private checkedAt = 0;
  private inFlight: Promise<UpdateStatus> | null = null;

  constructor(
    private readonly currentVersion: string,
    private readonly fetchRelease: ReleaseFetcher = fetchLatestRelease,
    private readonly intervalMs = UPDATE_CHECK_INTERVAL_MS,
    private readonly now: () => number = Date.now,
  ) {
    this.cached = { currentVersion, update: null };
  }

  async getStatus(): Promise<UpdateStatus> {
    if (this.checkedAt > 0 && this.now() - this.checkedAt < this.intervalMs) return this.cached;
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.refresh().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async refresh(): Promise<UpdateStatus> {
    try {
      const release = parseRelease(await this.fetchRelease());
      if (release) {
        const parsed = parseVersion(release.tag_name);
        const update =
          parsed && isNewerVersion(release.tag_name, this.currentVersion)
            ? {
                version: parsed.join("."),
                url: release.html_url,
                publishedAt: release.published_at ?? null,
              }
            : null;
        this.cached = { currentVersion: this.currentVersion, update };
      }
    } catch {
      // Update checks must never interfere with startup or normal use.
    } finally {
      this.checkedAt = this.now();
    }
    return this.cached;
  }
}

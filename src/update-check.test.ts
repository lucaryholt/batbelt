import { describe, expect, it, vi } from "vitest";
import { isNewerVersion, UpdateChecker } from "./update-check.js";

const release = (tag: string) => ({
  tag_name: tag,
  html_url: `https://github.com/lucaryholt/batbelt/releases/tag/${tag}`,
  published_at: "2026-10-08T08:00:00Z",
});

describe("update checker", () => {
  it("compares strict release versions", () => {
    expect(isNewerVersion("v1.2.0", "1.1.9")).toBe(true);
    expect(isNewerVersion("1.1.0", "1.1.0")).toBe(false);
    expect(isNewerVersion("1.0.9", "1.1.0")).toBe(false);
    expect(isNewerVersion("latest", "1.1.0")).toBe(false);
  });

  it("returns a newer release", async () => {
    const checker = new UpdateChecker("1.1.0", async () => release("v1.2.0"));
    await expect(checker.getStatus()).resolves.toEqual({
      currentVersion: "1.1.0",
      update: {
        version: "1.2.0",
        url: "https://github.com/lucaryholt/batbelt/releases/tag/v1.2.0",
        publishedAt: "2026-10-08T08:00:00Z",
      },
    });
  });

  it.each(["v1.1.0", "v1.0.9", "next"])("ignores non-newer tag %s", async (tag) => {
    const checker = new UpdateChecker("1.1.0", async () => release(tag));
    await expect(checker.getStatus()).resolves.toEqual({ currentVersion: "1.1.0", update: null });
  });

  it("ignores malformed payloads and untrusted URLs", async () => {
    const malformed = new UpdateChecker("1.1.0", async () => ({ tag_name: "v2.0.0" }));
    const untrusted = new UpdateChecker("1.1.0", async () => ({
      ...release("v2.0.0"),
      html_url: "https://example.com/download",
    }));
    await expect(malformed.getStatus()).resolves.toEqual({ currentVersion: "1.1.0", update: null });
    await expect(untrusted.getStatus()).resolves.toEqual({ currentVersion: "1.1.0", update: null });
  });

  it("fails silently when the request fails", async () => {
    const checker = new UpdateChecker("1.1.0", async () => {
      throw new Error("offline");
    });
    await expect(checker.getStatus()).resolves.toEqual({ currentVersion: "1.1.0", update: null });
  });

  it("reuses fresh cache and refreshes after expiry", async () => {
    let now = 1;
    const fetcher = vi.fn(async () => release("v1.2.0"));
    const checker = new UpdateChecker("1.1.0", fetcher, 100, () => now);
    await checker.getStatus();
    await checker.getStatus();
    expect(fetcher).toHaveBeenCalledTimes(1);
    now = 102;
    await checker.getStatus();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("retains stale successful data after refresh failure", async () => {
    let now = 1;
    const fetcher = vi
      .fn<() => Promise<unknown>>()
      .mockResolvedValueOnce(release("v1.2.0"))
      .mockRejectedValueOnce(new Error("offline"));
    const checker = new UpdateChecker("1.1.0", fetcher, 100, () => now);
    const initial = await checker.getStatus();
    now = 102;
    await expect(checker.getStatus()).resolves.toEqual(initial);
  });

  it("shares concurrent refreshes", async () => {
    let resolveFetch!: (value: unknown) => void;
    const fetcher = vi.fn(
      () =>
        new Promise<unknown>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const checker = new UpdateChecker("1.1.0", fetcher);
    const first = checker.getStatus();
    const second = checker.getStatus();
    expect(fetcher).toHaveBeenCalledTimes(1);
    resolveFetch(release("v1.2.0"));
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
  });
});

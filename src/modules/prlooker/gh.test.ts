import { describe, expect, it } from "vitest";
import {
  fetchInbox,
  ghHealth,
  mergeInboxItems,
  parseSearchItems,
  searchPrsArgs,
} from "./gh.js";
import type { GhResult, InboxItem } from "./types.js";

const sample = {
  number: 12,
  title: "Fix login",
  url: "https://github.com/acme/app/pull/12",
  repository: { nameWithOwner: "acme/app" },
  author: { login: "ada" },
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-02T00:00:00Z",
  isDraft: false,
  labels: [{ name: "bug" }],
};

function item(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    number: 1,
    title: "A",
    url: "https://github.com/acme/app/pull/1",
    repository: "acme/app",
    author: "ada",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-02T00:00:00Z",
    isDraft: false,
    labels: [],
    reasons: ["review"],
    ...overrides,
  };
}

describe("prlooker gh", () => {
  it("builds search argv", () => {
    expect(searchPrsArgs(["--review-requested=@me"])).toEqual([
      "search",
      "prs",
      "--review-requested=@me",
      "--state=open",
      "--limit",
      "50",
      "--json",
      "number,title,url,repository,author,createdAt,updatedAt,isDraft,labels",
    ]);
  });

  it("parses gh search JSON objects", () => {
    const [parsed] = parseSearchItems(JSON.stringify([sample]), "review");
    expect(parsed).toMatchObject({
      number: 12,
      title: "Fix login",
      repository: "acme/app",
      author: "ada",
      labels: ["bug"],
      reasons: ["review"],
    });
  });

  it("dedupes by URL and unions reasons, newest first", () => {
    const merged = mergeInboxItems([
      [item({ url: "https://a", updatedAt: "2026-01-01T00:00:00Z", reasons: ["review"] })],
      [item({ url: "https://a", updatedAt: "2026-01-01T00:00:00Z", reasons: ["assigned"] })],
      [item({ url: "https://b", updatedAt: "2026-01-03T00:00:00Z", reasons: ["authored"] })],
    ]);
    expect(merged.map((row) => row.url)).toEqual(["https://b", "https://a"]);
    expect(merged[1].reasons).toEqual(["review", "assigned"]);
  });

  it("reports missing gh and a logged-in user", async () => {
    await expect(
      ghHealth(async () => {
        throw new Error("`gh` was not found on PATH. Install the GitHub CLI.");
      }),
    ).resolves.toEqual({ ghAvailable: false, loggedIn: false });

    await expect(
      ghHealth(async () => ({
        ok: true,
        code: 0,
        stdout: JSON.stringify({ login: "ada" }),
        stderr: "",
      })),
    ).resolves.toEqual({ ghAvailable: true, loggedIn: true, login: "ada" });
  });

  it("runs the four inbox searches plus teams and tags reasons", async () => {
    const calls: string[][] = [];
    const run = async (args: string[]): Promise<GhResult> => {
      calls.push(args);
      if (args[0] === "api") {
        return { ok: true, code: 0, stdout: JSON.stringify({ login: "ada" }), stderr: "" };
      }
      const reason = args.includes("--assignee=@me")
        ? "assigned"
        : args.some((arg) => arg.startsWith("--review-requested=") && arg !== "--review-requested=@me")
          ? "team"
          : "review";
      return {
        ok: true,
        code: 0,
        stdout: JSON.stringify([
          {
            ...sample,
            url: `https://github.com/acme/app/pull/${reason}`,
            title: reason,
          },
        ]),
        stderr: "",
      };
    };
    const inbox = await fetchInbox({ pollSeconds: 60, teams: ["acme/core"] }, run);
    expect(inbox.viewer).toBe("ada");
    expect(inbox.items).toHaveLength(3);
    expect(calls.filter((args) => args[0] === "search")).toHaveLength(5);
    expect(calls.some((args) => args.includes("--review-requested=acme/core"))).toBe(true);
  });
});

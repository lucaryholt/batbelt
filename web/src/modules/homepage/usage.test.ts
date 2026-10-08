import { describe, expect, it } from "vitest";
import {
  MAX_USAGE_COUNT,
  MAX_USAGE_ENTRIES,
  loadUsage,
  parseUsage,
  recordUsage,
  type StorageLike,
} from "./usage";

function memoryStorage(initial: string | null = null): StorageLike & { value: string | null } {
  return {
    value: initial,
    getItem() {
      return this.value;
    },
    setItem(_key, value) {
      this.value = value;
    },
  };
}

describe("Homepage usage storage", () => {
  it("rejects malformed and unknown-version data", () => {
    expect(parseUsage("{")).toEqual({ version: 1, counts: {} });
    expect(parseUsage('{"version":2,"counts":{"shortcut:a":9}}')).toEqual({
      version: 1,
      counts: {},
    });
  });

  it("validates and caps stored counts", () => {
    expect(parseUsage(JSON.stringify({
      version: 1,
      counts: { good: MAX_USAGE_COUNT + 5, zero: 0, decimal: 1.5, bad: "3" },
    }))).toEqual({ version: 1, counts: { good: MAX_USAGE_COUNT } });
  });

  it("increments and persists stable result keys", () => {
    const storage = memoryStorage();
    const first = recordUsage({ version: 1, counts: {} }, "page:kubefwd:services", storage);
    const second = recordUsage(first, "page:kubefwd:services", storage);
    expect(second.counts["page:kubefwd:services"]).toBe(2);
    expect(loadUsage(storage)).toEqual(second);
  });

  it("keeps only the most recent bounded entries", () => {
    let store = { version: 1 as const, counts: {} as Record<string, number> };
    for (let index = 0; index < MAX_USAGE_ENTRIES + 5; index += 1) {
      store = recordUsage(store, `shortcut:${index}`, undefined);
    }
    expect(Object.keys(store.counts)).toHaveLength(MAX_USAGE_ENTRIES);
    expect(store.counts["shortcut:0"]).toBeUndefined();
    expect(store.counts[`shortcut:${MAX_USAGE_ENTRIES + 4}`]).toBe(1);
  });

  it("continues in memory when storage throws", () => {
    const storage: StorageLike = {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("blocked");
      },
    };
    expect(loadUsage(storage)).toEqual({ version: 1, counts: {} });
    expect(recordUsage({ version: 1, counts: {} }, "action:kubefwd:start", storage).counts).toEqual({
      "action:kubefwd:start": 1,
    });
  });
});

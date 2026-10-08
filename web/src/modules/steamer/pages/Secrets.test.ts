import { describe, expect, it } from "vitest";
import { changedEnvironments, changesFor } from "./Secrets";

describe("Steamer secret changes", () => {
  it("does not add a key that is absent from another environment", () => {
    const baseline = {
      dev: { SECRET_A: "old-dev", SECRET_B: "dev-only" },
      prod: { SECRET_A: "old-prod" },
    };
    const drafts = {
      dev: { SECRET_A: "new-dev", SECRET_B: "dev-only" },
      prod: { SECRET_A: "new-prod" },
    };

    expect(changesFor(baseline, drafts, ["dev", "prod"])).toEqual([
      {
        environment: "dev",
        key: "SECRET_A",
        kind: "changed",
        before: "old-dev",
        after: "new-dev",
      },
      {
        environment: "prod",
        key: "SECRET_A",
        kind: "changed",
        before: "old-prod",
        after: "new-prod",
      },
    ]);
    expect(Object.hasOwn(drafts.prod, "SECRET_B")).toBe(false);
  });

  it("distinguishes an empty value from an absent key", () => {
    expect(
      changesFor(
        { dev: { EMPTY: "", REMOVE: "x" } },
        { dev: { EMPTY: "", ADD: "" } },
        ["dev"],
      ),
    ).toEqual([
      { environment: "dev", key: "ADD", kind: "added", after: "" },
      { environment: "dev", key: "REMOVE", kind: "removed", before: "x" },
    ]);
  });

  it("limits changes to selected environments", () => {
    expect(
      changesFor(
        { dev: { KEY: "old" }, prod: { KEY: "old" } },
        { dev: { KEY: "new" }, prod: { KEY: "new" } },
        ["dev"],
      ),
    ).toEqual([
      {
        environment: "dev",
        key: "KEY",
        kind: "changed",
        before: "old",
        after: "new",
      },
    ]);
  });

  it("generates commands only for environments with changes", () => {
    const changes = changesFor(
      { dev: { KEY: "old" }, prod: { KEY: "same" } },
      { dev: { KEY: "new" }, prod: { KEY: "same" } },
      ["dev", "prod"],
    );

    expect(changedEnvironments(changes)).toEqual(["dev"]);
  });
});

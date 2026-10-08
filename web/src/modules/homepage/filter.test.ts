import { describe, expect, it } from "vitest";
import {
  fuzzyTokenScore,
  searchModuleActions,
  searchModulePages,
  searchShortcuts,
  shortcutUsageKey,
  usageBoost,
} from "./filter";
import type { ModuleDescriptor } from "../../shell/types";
import type { Section } from "./types";

const modules: ModuleDescriptor[] = [
  {
    id: "homepage",
    title: "Homepage",
    pages: [{ id: "links", label: "Links", path: "links" }],
    actions: [{
      id: "home-action",
      label: "Home action",
      description: "Should not be searchable.",
      method: "POST",
      path: "/api/homepage/action",
      successMessage: "Done.",
    }],
  },
  {
    id: "kubefwd",
    title: "Kubefwd",
    pages: [
      { id: "services", label: "Services", path: "services" },
      { id: "ports", label: "Port Checker", path: "ports" },
    ],
    actions: [{
      id: "start-default-services",
      label: "Start default services",
      description: "Start configured default port forwards.",
      keywords: ["defaults", "launch"],
      method: "POST",
      path: "/api/kubefwd/services/start-defaults",
      successMessage: "Started defaults.",
    }],
  },
  {
    id: "steamer",
    title: "Steamer",
    pages: [
      { id: "secrets", label: "Secrets", path: "secrets" },
      { id: "settings", label: "Settings", path: "settings" },
    ],
    actions: [],
  },
];

describe("searchModuleActions", () => {
  it("matches module, label, description, and keywords", () => {
    expect(searchModuleActions(modules, "kubefwd defaults")[0]).toMatchObject({
      id: "action:kubefwd:start-default-services",
      moduleTitle: "Kubefwd",
    });
    expect(searchModuleActions(modules, "start port forwards")).toHaveLength(1);
    expect(searchModuleActions(modules, "launch")).toHaveLength(1);
  });

  it("returns no actions for empty queries or Homepage", () => {
    expect(searchModuleActions(modules, "")).toEqual([]);
    expect(searchModuleActions(modules, "home action")).toEqual([]);
  });

  it("uses only supplied enabled descriptors", () => {
    expect(searchModuleActions(modules.slice(0, 1), "defaults")).toEqual([]);
  });

  it("tolerates omitted characters and lets usage break close matches", () => {
    expect(searchModuleActions(modules, "strt deflts")).toHaveLength(1);
    const used = searchModuleActions(modules, "start", {
      "action:kubefwd:start-default-services": 10,
    });
    expect(used[0]?.score).toBeGreaterThan(used[0]?.textScore ?? Infinity);
  });
});

describe("searchModulePages", () => {
  it("returns no pages for an empty query", () => {
    expect(searchModulePages(modules, "  ")).toEqual([]);
  });

  it("excludes Homepage from results", () => {
    expect(searchModulePages(modules, "homepage links")).toEqual([]);
  });

  it("matches module titles and IDs", () => {
    expect(searchModulePages(modules, "kubefwd").map((result) => result.pageLabel)).toEqual([
      "Services",
      "Port Checker",
    ]);
  });

  it("matches page labels, IDs, and paths", () => {
    expect(searchModulePages(modules, "settings")[0]).toMatchObject({
      moduleTitle: "Steamer",
      pageLabel: "Settings",
      path: "/steamer/settings",
    });
    expect(searchModulePages(modules, "ports")[0]?.path).toBe("/kubefwd/ports");
  });

  it("requires every query token to match", () => {
    expect(searchModulePages(modules, "kubefwd ports").map((result) => result.path)).toEqual([
      "/kubefwd/ports",
    ]);
    expect(searchModulePages(modules, "steamer ports")).toEqual([]);
  });

  it("orders by relevance and uses descriptor order for ties", () => {
    expect(searchModulePages(modules, "e").map((result) => result.path)).toEqual([
      "/steamer/secrets",
      "/steamer/settings",
      "/kubefwd/services",
      "/kubefwd/ports",
    ]);
    expect(searchModulePages(modules, "kubefwd").map((result) => result.path)).toEqual([
      "/kubefwd/services",
      "/kubefwd/ports",
    ]);
  });

  it("only searches descriptors supplied by the enabled-module response", () => {
    expect(searchModulePages(modules.slice(0, 2), "steamer")).toEqual([]);
  });

  it("fuzzy matches typos and applies usage without defeating stronger text", () => {
    expect(searchModulePages(modules, "setings")[0]?.path).toBe("/steamer/settings");
    expect(usageBoost(1_000_000)).toBeLessThan(200);
  });
});

describe("fuzzy scoring", () => {
  it("prefers exact, prefix, boundary, and compact matches", () => {
    expect(fuzzyTokenScore("ports", "ports")).toBeGreaterThan(fuzzyTokenScore("ports", "port checker") ?? 0);
    expect(fuzzyTokenScore("pc", "port checker")).toBeGreaterThan(fuzzyTokenScore("pc", "proxy context") ?? 0);
  });

  it("normalizes case and diacritics and rejects unrelated values", () => {
    expect(fuzzyTokenScore("resume", "Résumé")).not.toBeNull();
    expect(fuzzyTokenScore("xyz", "services")).toBeNull();
  });
});

describe("searchShortcuts", () => {
  const sections: Section[] = [
    {
      id: "tools",
      title: "Developer tools",
      collapsed: false,
      shortcuts: [
        { id: "github", kind: "url", label: "GitHub", url: "https://github.com" },
        { id: "grafana", kind: "url", label: "Grafana", url: "https://metrics.example.com" },
      ],
    },
  ];

  it("fuzzy matches names before falling back to URLs", () => {
    expect(searchShortcuts(sections, "gthb").map((hit) => hit.shortcut.id)).toEqual(["github"]);
    expect(searchShortcuts(sections, "metrics").map((hit) => hit.shortcut.id)).toEqual(["grafana"]);
  });

  it("uses frequency to rank close matches with stable identities", () => {
    const key = shortcutUsageKey("grafana");
    const results = searchShortcuts(sections, "g", { [key]: 32 });
    expect(results[0]?.id).toBe(key);
    expect(results[0]?.shortcut.id).toBe("grafana");
  });
});

import { describe, expect, it } from "vitest";
import { searchModuleActions, searchModulePages } from "./filter";
import type { ModuleDescriptor } from "../../shell/types";

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

  it("preserves enabled module and page order", () => {
    expect(searchModulePages(modules, "e").map((result) => result.path)).toEqual([
      "/kubefwd/services",
      "/kubefwd/ports",
      "/steamer/secrets",
      "/steamer/settings",
    ]);
  });

  it("only searches descriptors supplied by the enabled-module response", () => {
    expect(searchModulePages(modules.slice(0, 2), "steamer")).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { searchModulePages } from "./filter";
import type { ModuleDescriptor } from "../../shell/types";

const modules: ModuleDescriptor[] = [
  {
    id: "homepage",
    title: "Homepage",
    pages: [{ id: "links", label: "Links", path: "links" }],
  },
  {
    id: "kubefwd",
    title: "Kubefwd",
    pages: [
      { id: "services", label: "Services", path: "services" },
      { id: "ports", label: "Port Checker", path: "ports" },
    ],
  },
  {
    id: "steamer",
    title: "Steamer",
    pages: [
      { id: "secrets", label: "Secrets", path: "secrets" },
      { id: "settings", label: "Settings", path: "settings" },
    ],
  },
];

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

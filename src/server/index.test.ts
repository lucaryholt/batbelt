import { describe, expect, it } from "vitest";
import { createHostApp } from "./index.js";
import { toDescriptor } from "../modules/types.js";
import { kubefwdModule } from "../modules/kubefwd/index.js";

describe("host module metadata", () => {
  it("exposes the advertised Kubefwd action contract", () => {
    const descriptor = toDescriptor(kubefwdModule);
    expect(descriptor.id).toBe("kubefwd");
    expect(descriptor.actions).toEqual(
      expect.arrayContaining([expect.objectContaining({
        id: "start-default-services",
        label: "Start default services",
        method: "POST",
        path: "/api/kubefwd/services/start-defaults",
        successMessage: "Started default Kubefwd services.",
      })]),
    );
  });

  it("defaults actions to an empty collection", () => {
    expect(toDescriptor({
      id: "example",
      title: "Example",
      pages: [],
      createRoutes: () => createHostApp(),
    }).actions).toEqual([]);
  });
});

describe("host update endpoint", () => {
  it("returns the checker response contract", async () => {
    const status = {
      currentVersion: "1.1.0",
      update: {
        version: "1.2.0",
        url: "https://github.com/lucaryholt/batbelt/releases/tag/v1.2.0",
        publishedAt: null,
      },
    };
    const app = createHostApp({ getStatus: async () => status });
    const response = await app.request("/api/update");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(status);
  });
});

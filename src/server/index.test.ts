import { describe, expect, it } from "vitest";
import { createHostApp } from "./index.js";

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

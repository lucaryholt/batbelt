import { describe, expect, it } from "vitest";
import { openBaoSecretUrl } from "../../../web/src/modules/steamer/lib/openbao-url.js";

describe("openBaoSecretUrl", () => {
  it("builds an OpenBao secret page URL", () => {
    expect(
      openBaoSecretUrl({
        addr: "https://bao.example.com/",
        mount: "/team secrets/",
        path: "/apps/my service/",
      }),
    ).toBe("https://bao.example.com/ui/vault/secrets/team%20secrets/show/apps/my%20service");
  });

  it("includes an encoded namespace when configured", () => {
    expect(
      openBaoSecretUrl({
        addr: "https://bao.example.com",
        mount: "secret",
        path: "apps/demo",
        namespace: "teams/platform",
      }),
    ).toBe(
      "https://bao.example.com/ui/vault/secrets/secret/show/apps/demo?namespace=teams%2Fplatform",
    );
  });
});

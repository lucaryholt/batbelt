import { access, readFile, stat } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { cleanupPreparedWrite, formatBaoCommand, prepareKvPut } from "./bao.js";

describe("Steamer Bao write preparation", () => {
  it("renders shell-safe exact commands", () => {
    expect(formatBaoCommand(["kv", "put", "-mount=team secret", "apps/o'hare"])).toBe(
      "bao kv put '-mount=team secret' 'apps/o'\\''hare'",
    );
  });

  it("stages a protected payload and cleans it up", async () => {
    const prepared = await prepareKvPut("secret", "apps/demo", { password: "s3cret" });
    const payloadPath = prepared.args.at(-1)!.slice(1);
    expect(prepared.command).toContain(`@${payloadPath}`);
    expect(JSON.parse(await readFile(payloadPath, "utf8"))).toEqual({ password: "s3cret" });
    expect((await stat(payloadPath)).mode & 0o777).toBe(0o600);

    await cleanupPreparedWrite(prepared);
    await expect(access(payloadPath)).rejects.toThrow();
  });
});

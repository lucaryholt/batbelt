import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { loadConfig, normalizeConfig, saveConfig } from "./config.js";
import { configFilePath } from "./paths.js";

describe("homepage config", () => {
  const prev = process.env.XDG_CONFIG_HOME;
  let dir: string;

  afterEach(() => {
    if (prev === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = prev;
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  function isolate(): void {
    dir = mkdtempSync(join(tmpdir(), "batbelt-homepage-"));
    process.env.XDG_CONFIG_HOME = dir;
  }

  it("loads an empty file as no sections", async () => {
    isolate();
    const path = configFilePath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "");
    await expect(loadConfig()).resolves.toEqual({ starred: [], sections: [] });
  });

  it("loads a missing file as no sections", async () => {
    isolate();
    await expect(loadConfig()).resolves.toEqual({ starred: [], sections: [] });
  });

  it("rejects javascript: shortcut URLs", () => {
    expect(() =>
      normalizeConfig({
        sections: [
          {
            id: "airflow",
            title: "Airflow",
            shortcuts: [{ id: "dev", label: "Dev", url: "javascript:alert(1)" }],
          },
        ],
      }),
    ).toThrow(/http or https/i);
  });

  it("rejects a non-http logo URL", () => {
    expect(() =>
      normalizeConfig({
        sections: [
          {
            id: "airflow",
            title: "Airflow",
            logo: "data:image/png;base64,xxxx",
            shortcuts: [],
          },
        ],
      }),
    ).toThrow(/http or https/i);
  });

  it("rejects duplicate ids", () => {
    expect(() =>
      normalizeConfig({
        sections: [
          {
            id: "dup",
            title: "A",
            shortcuts: [{ id: "dup", label: "Dev", url: "https://example.com" }],
          },
        ],
      }),
    ).toThrow(/duplicate/i);
  });

  it("rejects a missing title", () => {
    expect(() =>
      normalizeConfig({
        sections: [{ id: "x", title: "   ", shortcuts: [] }],
      }),
    ).toThrow(/title/i);
  });

  it("round-trips a valid section", async () => {
    isolate();
    const saved = await saveConfig({
      sections: [
        {
          id: "airflow",
          title: "Airflow",
          logo: "https://example.com/airflow.svg",
          collapsed: true,
          shortcuts: [{ id: "dev", label: "Dev", url: "https://airflow-dev.example.com" }],
        },
      ],
    });
    expect(saved.starred).toEqual([]);
    expect(saved.sections[0].collapsed).toBe(true);
    expect(await loadConfig()).toEqual(saved);
  });

  it("defaults missing starred to an empty list", () => {
    const cfg = normalizeConfig({
      sections: [
        {
          id: "airflow",
          title: "Airflow",
          shortcuts: [{ id: "dev", label: "Dev", url: "https://example.com" }],
        },
      ],
    });
    expect(cfg.starred).toEqual([]);
  });

  it("drops unknown and duplicate starred ids and keeps order", () => {
    const cfg = normalizeConfig({
      starred: ["prod", "missing", "dev", "prod", 12],
      sections: [
        {
          id: "airflow",
          title: "Airflow",
          shortcuts: [
            { id: "dev", label: "Dev", url: "https://dev.example.com" },
            { id: "prod", label: "Prod", url: "https://prod.example.com" },
          ],
        },
      ],
    });
    expect(cfg.starred).toEqual(["prod", "dev"]);
  });
});

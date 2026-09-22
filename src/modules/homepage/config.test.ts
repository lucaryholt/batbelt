import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { emptyConfig, loadConfig, normalizeConfig, saveConfig } from "./config.js";
import { configFilePath } from "./paths.js";

const empty = emptyConfig();

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
    await expect(loadConfig()).resolves.toEqual(empty);
  });

  it("loads a missing file as no sections", async () => {
    isolate();
    await expect(loadConfig()).resolves.toEqual(empty);
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
      starred: [],
      terminal: { kind: "terminal-app" },
      sections: [
        {
          id: "airflow",
          title: "Airflow",
          logo: "https://example.com/airflow.svg",
          collapsed: true,
          shortcuts: [{ id: "dev", kind: "url", label: "Dev", url: "https://airflow-dev.example.com" }],
        },
      ],
    });
    expect(saved.starred).toEqual([]);
    expect(saved.terminal).toEqual({ kind: "terminal-app" });
    expect(saved.sections[0].collapsed).toBe(true);
    expect(saved.sections[0].shortcuts[0]).toMatchObject({ kind: "url", label: "Dev" });
    expect(await loadConfig()).toEqual(saved);
  });

  it("defaults missing starred to an empty list and missing kind to url", () => {
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
    expect(cfg.terminal).toEqual({ kind: "terminal-app" });
    expect(cfg.sections[0].shortcuts[0]).toEqual({
      id: "dev",
      kind: "url",
      label: "Dev",
      url: "https://example.com",
    });
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

  it("accepts a directory shortcut and keeps ~ in the stored path", () => {
    const cfg = normalizeConfig({
      sections: [
        {
          id: "projects",
          title: "Projects",
          shortcuts: [
            { id: "p1", kind: "dir", label: "batbelt", path: "~/scripts/batbelt", tool: "code" },
          ],
        },
      ],
    });
    expect(cfg.sections[0].shortcuts[0]).toEqual({
      id: "p1",
      kind: "dir",
      label: "batbelt",
      path: "~/scripts/batbelt",
      tool: "code",
    });
  });

  it("treats a path-only row without kind as a directory shortcut", () => {
    const cfg = normalizeConfig({
      sections: [
        {
          id: "projects",
          title: "Projects",
          shortcuts: [{ id: "p1", label: "batbelt", path: "/tmp/batbelt", tool: "pi" }],
        },
      ],
    });
    expect(cfg.sections[0].shortcuts[0]).toMatchObject({ kind: "dir", tool: "pi", path: "/tmp/batbelt" });
  });

  it("rejects a relative directory path", () => {
    expect(() =>
      normalizeConfig({
        sections: [
          {
            id: "projects",
            title: "Projects",
            shortcuts: [{ id: "p1", kind: "dir", label: "rel", path: "scripts/batbelt", tool: "code" }],
          },
        ],
      }),
    ).toThrow(/absolute/i);
  });

  it("rejects a directory shortcut with an unknown tool", () => {
    expect(() =>
      normalizeConfig({
        sections: [
          {
            id: "projects",
            title: "Projects",
            shortcuts: [{ id: "p1", kind: "dir", label: "x", path: "/tmp/x", tool: "emacs" }],
          },
        ],
      }),
    ).toThrow(/code or pi/i);
  });

  it("rejects a directory path containing NUL", () => {
    expect(() =>
      normalizeConfig({
        sections: [
          {
            id: "projects",
            title: "Projects",
            shortcuts: [{ id: "p1", kind: "dir", label: "x", path: "/tmp/x\0oops", tool: "code" }],
          },
        ],
      }),
    ).toThrow(/NUL/i);
  });

  it("does not require the folder to exist at save time", () => {
    expect(() =>
      normalizeConfig({
        sections: [
          {
            id: "projects",
            title: "Projects",
            shortcuts: [
              { id: "p1", kind: "dir", label: "missing", path: "/definitely/not/here", tool: "code" },
            ],
          },
        ],
      }),
    ).not.toThrow();
  });

  it("defaults a missing terminal to Terminal.app", () => {
    const cfg = normalizeConfig({ sections: [] });
    expect(cfg.terminal).toEqual({ kind: "terminal-app" });
  });

  it("accepts each terminal kind", () => {
    expect(normalizeConfig({ terminal: { kind: "kitty-tab", listenOn: "unix:/tmp/mykitty" } }).terminal).toEqual({
      kind: "kitty-tab",
      listenOn: "unix:/tmp/mykitty",
    });
    expect(normalizeConfig({ terminal: { kind: "terminal-app" } }).terminal).toEqual({ kind: "terminal-app" });
    expect(
      normalizeConfig({
        terminal: { kind: "custom", argv: ["wezterm", "cli", "spawn", "--cwd", "{path}", "--", "{cmd}"] },
      }).terminal,
    ).toEqual({
      kind: "custom",
      argv: ["wezterm", "cli", "spawn", "--cwd", "{path}", "--", "{cmd}"],
    });
  });

  it("rewrites a cursor folder tool to code", () => {
    const cfg = normalizeConfig({
      sections: [
        {
          id: "projects",
          title: "Projects",
          shortcuts: [{ id: "p1", kind: "dir", label: "batbelt", path: "/tmp/batbelt", tool: "cursor" }],
        },
      ],
    });
    expect((cfg.sections[0].shortcuts[0] as { tool: string }).tool).toBe("code");
  });

  it("rewrites iterm-tab to Terminal.app", () => {
    expect(normalizeConfig({ terminal: { kind: "iterm-tab" } }).terminal).toEqual({ kind: "terminal-app" });
  });

  it("rejects an unknown terminal kind", () => {
    expect(() => normalizeConfig({ terminal: { kind: "warp" } })).toThrow(/terminal.kind/i);
  });

  it("rejects an empty custom argv", () => {
    expect(() => normalizeConfig({ terminal: { kind: "custom", argv: [] } })).toThrow(/argv/i);
  });

  it("rejects a blank custom argv token", () => {
    expect(() => normalizeConfig({ terminal: { kind: "custom", argv: ["kitty", "  "] } })).toThrow(/argv\[1]/);
  });

  it("allows starring a directory shortcut", () => {
    const cfg = normalizeConfig({
      starred: ["p1"],
      sections: [
        {
          id: "projects",
          title: "Projects",
          shortcuts: [{ id: "p1", kind: "dir", label: "batbelt", path: "/tmp/batbelt", tool: "code" }],
        },
      ],
    });
    expect(cfg.starred).toEqual(["p1"]);
  });
});

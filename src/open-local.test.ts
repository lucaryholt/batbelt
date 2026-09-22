import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  appleScriptStringLiteral,
  detectTools,
  kittyBinCandidates,
  kittyRemoteArgs,
  kittyWindowArgs,
  openDirectory,
  resolveKittySocket,
  substituteArgv,
  terminalAppScript,
} from "./open-local.js";

describe("open-local builders", () => {
  it("builds kitty remote-control argv with optional --to", () => {
    expect(kittyRemoteArgs("/tmp/proj", undefined, "")).toEqual([
      "@",
      "launch",
      "--type=tab",
      "--cwd",
      "/tmp/proj",
      "--",
      "pi",
    ]);
    expect(kittyRemoteArgs("/tmp/proj", "unix:/tmp/mykitty", "")).toEqual([
      "@",
      "--to",
      "unix:/tmp/mykitty",
      "launch",
      "--type=tab",
      "--cwd",
      "/tmp/proj",
      "--",
      "pi",
    ]);
  });

  it("passes the server PATH to the launched program", () => {
    expect(kittyRemoteArgs("/tmp/proj", undefined, "/opt/bin:/usr/bin")).toEqual([
      "@",
      "launch",
      "--type=tab",
      "--cwd",
      "/tmp/proj",
      "--env",
      "PATH=/opt/bin:/usr/bin",
      "--",
      "pi",
    ]);
  });

  it("builds a kitty OS-window fallback argv", () => {
    expect(kittyWindowArgs("/tmp/proj")).toEqual(["--directory", "/tmp/proj", "-e", "pi"]);
  });

  it("lists the kitty.app bundle after the bare binary name", () => {
    expect(kittyBinCandidates("kitten", "/Users/me")).toEqual([
      "kitten",
      "/Applications/kitty.app/Contents/MacOS/kitten",
      "/Users/me/Applications/kitty.app/Contents/MacOS/kitten",
    ]);
  });

  it("substitutes {path} and {cmd} inside existing tokens", () => {
    expect(substituteArgv(["wezterm", "cli", "spawn", "--cwd", "{path}", "--", "{cmd}"], "/tmp/proj")).toEqual([
      "wezterm",
      "cli",
      "spawn",
      "--cwd",
      "/tmp/proj",
      "--",
      "pi",
    ]);
  });

  it("escapes quotes in AppleScript string literals and uses quoted form of", () => {
    expect(appleScriptStringLiteral(`say "hi"`)).toBe(`"say \\"hi\\""`);
    const script = terminalAppScript(`/tmp/has "quotes"`);
    expect(script).toContain(`set dirPath to "/tmp/has \\"quotes\\""`);
    expect(script).toContain("quoted form of dirPath");
    expect(script).not.toContain(`cd /tmp/has`);
  });
});

describe("openDirectory", () => {
  let socketDir = "";

  beforeAll(async () => {
    socketDir = await mkdtemp(join(tmpdir(), "kitty-sock-"));
  });

  it("spawns code detached on the directory", async () => {
    const calls: { bin: string; args: string[] }[] = [];
    const result = await openDirectory(
      { path: "/tmp/proj", tool: "code", terminal: { kind: "terminal-app" } },
      {
        spawnDetached: async (bin, args) => {
          calls.push({ bin, args });
        },
      },
    );
    expect(result).toEqual({ path: "/tmp/proj" });
    expect(calls).toEqual([{ bin: "code", args: ["/tmp/proj"] }]);
  });

  it("surfaces a clear ENOENT for missing GUI tools", async () => {
    await expect(
      openDirectory(
        { path: "/tmp/proj", tool: "code", terminal: { kind: "terminal-app" } },
        {
          spawnDetached: async () => {
            const err = new Error("spawn code ENOENT") as NodeJS.ErrnoException;
            err.code = "ENOENT";
            throw new Error("`code` was not found on PATH. Install the VS Code shell command.");
          },
        },
      ),
    ).rejects.toThrow(/`code` was not found on PATH/);
  });

  it("uses kitten @ launch for kitty-tab and returns no fallback on success", async () => {
    const commands: { bin: string; args: string[] }[] = [];
    const result = await openDirectory(
      { path: "/tmp/proj", tool: "pi", terminal: { kind: "kitty-tab", listenOn: `unix:${socketDir}/mykitty` } },
      {
        lookPath: async (bin) => bin === "kitten",
        runCommand: async (bin, args) => {
          commands.push({ bin, args });
          return { code: 0, stdout: "", stderr: "" };
        },
        spawnDetached: async () => {
          throw new Error("should not fall back");
        },
      },
    );
    expect(result).toEqual({ path: "/tmp/proj" });
    expect(commands[0]).toEqual({
      bin: "kitten",
      args: kittyRemoteArgs("/tmp/proj", `unix:${socketDir}/mykitty`),
    });
  });

  it("uses the kitty.app bundle when nothing is on PATH", async () => {
    const commands: { bin: string; args: string[] }[] = [];
    await openDirectory(
      { path: "/tmp/proj", tool: "pi", terminal: { kind: "kitty-tab" } },
      {
        lookPath: async (bin) => bin === "/Applications/kitty.app/Contents/MacOS/kitten",
        runCommand: async (bin, args) => {
          commands.push({ bin, args });
          return { code: 0, stdout: "", stderr: "" };
        },
      },
    );
    expect(commands[0].bin).toBe("/Applications/kitty.app/Contents/MacOS/kitten");
  });

  it("reports kitty as available when only the app bundle has it", async () => {
    expect(
      await detectTools(async (bin) => bin === "/Applications/kitty.app/Contents/MacOS/kitty"),
    ).toEqual({ code: false, pi: false, kitten: false, kitty: true });
  });

  it("falls back to a Kitty window when remote control fails", async () => {
    const detached: { bin: string; args: string[] }[] = [];
    const result = await openDirectory(
      { path: "/tmp/proj", tool: "pi", terminal: { kind: "kitty-tab" } },
      {
        lookPath: async (bin) => bin === "kitten" || bin === "kitty",
        runCommand: async () => ({ code: 1, stdout: "", stderr: "connection refused" }),
        spawnDetached: async (bin, args) => {
          detached.push({ bin, args });
        },
      },
    );
    expect(result).toEqual({ path: "/tmp/proj", fallback: "kitty-window" });
    expect(detached).toEqual([{ bin: "kitty", args: kittyWindowArgs("/tmp/proj") }]);
  });

  it("points --to at the pid-suffixed socket kitty actually created", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kitty-sock-"));
    await writeFile(join(dir, "mykitty-4242"), "");
    const commands: { bin: string; args: string[] }[] = [];
    await openDirectory(
      { path: "/tmp/proj", tool: "pi", terminal: { kind: "kitty-tab", listenOn: `unix:${dir}/mykitty` } },
      {
        lookPath: async (bin) => bin === "kitten",
        runCommand: async (bin, args) => {
          commands.push({ bin, args });
          return { code: 0, stdout: "", stderr: "" };
        },
      },
    );
    expect(commands[0].args).toEqual(kittyRemoteArgs("/tmp/proj", `unix:${dir}/mykitty-4242`));
  });

  it("keeps the configured socket when no pid-suffixed one exists", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kitty-sock-"));
    expect(await resolveKittySocket(`unix:${dir}/mykitty`)).toBe(`unix:${dir}/mykitty`);
    await writeFile(join(dir, "mykitty"), "");
    expect(await resolveKittySocket(`unix:${dir}/mykitty`)).toBe(`unix:${dir}/mykitty`);
  });

  it("runs the Terminal.app script through osascript", async () => {
    const scripts: string[] = [];
    await openDirectory(
      { path: "/tmp/proj", tool: "pi", terminal: { kind: "terminal-app" } },
      { runOsascript: async (script) => { scripts.push(script); } },
    );
    expect(scripts).toEqual([terminalAppScript("/tmp/proj")]);
  });

  it("spawns a substituted custom argv", async () => {
    const calls: { bin: string; args: string[] }[] = [];
    await openDirectory(
      {
        path: "/tmp/proj",
        tool: "pi",
        terminal: { kind: "custom", argv: ["wezterm", "cli", "spawn", "--cwd", "{path}", "--", "{cmd}"] },
      },
      {
        spawnDetached: async (bin, args) => {
          calls.push({ bin, args });
        },
      },
    );
    expect(calls).toEqual([
      { bin: "wezterm", args: ["cli", "spawn", "--cwd", "/tmp/proj", "--", "pi"] },
    ]);
  });
});

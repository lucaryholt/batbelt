import { randomUUID } from "node:crypto";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { parse, stringify } from "yaml";
import { expandUserPath, isExpandedAbsolute } from "../../expand-path.js";
import type {
  DirShortcut,
  HomepageConfig,
  Section,
  Shortcut,
  TerminalConfig,
  UrlShortcut,
} from "./types.js";
import { isDirTool } from "./types.js";
import { configFilePath, ensureAppDirs } from "./paths.js";

export const emptyTerminal = (): TerminalConfig => ({ kind: "terminal-app" });

export const emptyConfig = (): HomepageConfig => ({
  starred: [],
  sections: [],
  terminal: emptyTerminal(),
});

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value as Record<string, unknown>;
}

function normalizeTerminal(raw: unknown): TerminalConfig {
  if (raw == null) return emptyTerminal();
  const row = asRecord(raw, "terminal");
  const kind = String(row.kind ?? "").trim();
  if (kind === "terminal-app" || kind === "iterm-tab") return { kind: "terminal-app" };
  if (kind === "kitty-tab") {
    const listenOn = String(row.listenOn ?? "").trim();
    return listenOn ? { kind: "kitty-tab", listenOn } : { kind: "kitty-tab" };
  }
  if (kind === "custom") {
    if (!Array.isArray(row.argv) || row.argv.length === 0) {
      throw new Error("terminal.argv must be a non-empty array");
    }
    const argv = row.argv.map((item, i) => {
      if (typeof item !== "string" || !item.trim()) {
        throw new Error(`terminal.argv[${i}] must be a non-empty string`);
      }
      return item.trim();
    });
    return { kind: "custom", argv };
  }
  throw new Error("terminal.kind must be kitty-tab, terminal-app, or custom");
}

function shortcutKind(row: Record<string, unknown>): "url" | "dir" {
  const kind = String(row.kind ?? "").trim();
  if (kind === "url" || kind === "dir") return kind;
  const url = String(row.url ?? "").trim();
  if (url) return "url";
  if (String(row.path ?? "").trim()) return "dir";
  throw new Error("shortcut is missing a URL or path");
}

function normalizeUrlShortcut(
  row: Record<string, unknown>,
  sectionTitle: string,
  index: number,
): UrlShortcut {
  const label = String(row.label ?? "").trim();
  const url = String(row.url ?? "").trim();
  if (!label) throw new Error(`Shortcut ${index} in "${sectionTitle}" is missing a label`);
  if (!url) throw new Error(`Shortcut "${label}" in "${sectionTitle}" is missing a URL`);
  if (!isHttpUrl(url)) {
    throw new Error(`Shortcut "${label}" in "${sectionTitle}" must use an http or https URL`);
  }
  return {
    id: String(row.id ?? "").trim() || randomUUID(),
    kind: "url",
    label,
    url,
  };
}

function normalizeDirShortcut(
  row: Record<string, unknown>,
  sectionTitle: string,
  index: number,
): DirShortcut {
  const label = String(row.label ?? "").trim();
  const path = String(row.path ?? "").trim();
  const rawTool = String(row.tool ?? "").trim();
  const tool = rawTool === "cursor" ? "code" : rawTool;
  if (!label) throw new Error(`Shortcut ${index} in "${sectionTitle}" is missing a label`);
  if (!path) throw new Error(`Shortcut "${label}" in "${sectionTitle}" is missing a path`);
  if (path.includes("\0")) {
    throw new Error(`Shortcut "${label}" in "${sectionTitle}" path must not contain NUL`);
  }
  if (!isExpandedAbsolute(path)) {
    throw new Error(`Shortcut "${label}" in "${sectionTitle}" path must be absolute or start with ~/`);
  }
  if (!isDirTool(tool)) {
    throw new Error(`Shortcut "${label}" in "${sectionTitle}" tool must be code or pi`);
  }
  return {
    id: String(row.id ?? "").trim() || randomUUID(),
    kind: "dir",
    label,
    path,
    tool,
  };
}

function normalizeShortcut(raw: unknown, sectionTitle: string, index: number): Shortcut {
  const row = asRecord(raw, `Shortcut ${index} in ${sectionTitle}`);
  try {
    const kind = shortcutKind(row);
    return kind === "dir"
      ? normalizeDirShortcut(row, sectionTitle, index)
      : normalizeUrlShortcut(row, sectionTitle, index);
  } catch (err) {
    const message = (err as Error).message;
    if (message === "shortcut is missing a URL or path") {
      const label = String(row.label ?? "").trim() || String(index);
      throw new Error(`Shortcut "${label}" in "${sectionTitle}" is missing a URL or path`);
    }
    throw err;
  }
}

function normalizeSection(raw: unknown, index: number): Section {
  const row = asRecord(raw, `Section ${index}`);
  const title = String(row.title ?? "").trim();
  if (!title) throw new Error(`Section ${index} is missing a title`);
  const logo = String(row.logo ?? "").trim();
  if (logo && !isHttpUrl(logo)) {
    throw new Error(`Section "${title}" logo must use an http or https URL`);
  }
  const shortcuts = Array.isArray(row.shortcuts)
    ? row.shortcuts.map((item, i) => normalizeShortcut(item, title, i))
    : [];
  const section: Section = {
    id: String(row.id ?? "").trim() || randomUUID(),
    title,
    collapsed: row.collapsed === true,
    shortcuts,
  };
  if (logo) section.logo = logo;
  return section;
}

function shortcutIdSet(sections: Section[]): Set<string> {
  const ids = new Set<string>();
  for (const section of sections) {
    for (const shortcut of section.shortcuts) ids.add(shortcut.id);
  }
  return ids;
}

function normalizeStarred(raw: unknown, sections: Section[]): string[] {
  const known = shortcutIdSet(sections);
  const seen = new Set<string>();
  const out: string[] = [];
  const list = Array.isArray(raw) ? raw : [];
  for (const item of list) {
    if (typeof item !== "string") continue;
    const id = item.trim();
    if (!id || seen.has(id) || !known.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function findShortcut(
  config: HomepageConfig,
  id: string,
): { shortcut: Shortcut; section: Section } | undefined {
  for (const section of config.sections) {
    const shortcut = section.shortcuts.find((item) => item.id === id);
    if (shortcut) return { shortcut, section };
  }
  return undefined;
}

export function expandShortcutPath(path: string): string {
  return expandUserPath(path);
}

export function normalizeConfig(raw: unknown): HomepageConfig {
  if (raw == null || raw === "") return emptyConfig();
  const row = asRecord(raw, "Homepage config");
  const sections = Array.isArray(row.sections) ? row.sections.map(normalizeSection) : [];
  const ids = new Set<string>();
  for (const section of sections) {
    if (ids.has(section.id)) throw new Error(`Duplicate section id: ${section.id}`);
    ids.add(section.id);
    for (const shortcut of section.shortcuts) {
      if (ids.has(shortcut.id)) throw new Error(`Duplicate shortcut id: ${shortcut.id}`);
      ids.add(shortcut.id);
    }
  }
  return {
    starred: normalizeStarred(row.starred, sections),
    sections,
    terminal: normalizeTerminal(row.terminal),
  };
}

export async function loadConfig(): Promise<HomepageConfig> {
  await ensureAppDirs();
  try {
    const text = await readFile(configFilePath(), "utf8");
    if (!text.trim()) return emptyConfig();
    return normalizeConfig(parse(text));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return emptyConfig();
    throw err;
  }
}

export async function saveConfig(config: HomepageConfig): Promise<HomepageConfig> {
  const normalized = normalizeConfig(config);
  await ensureAppDirs();
  const body = stringify(normalized);
  await writeFile(configFilePath(), body, { mode: 0o600 });
  await chmod(configFilePath(), 0o600);
  return normalized;
}

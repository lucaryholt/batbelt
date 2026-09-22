export type DirTool = "code" | "pi";

export type TerminalKind = "kitty-tab" | "terminal-app" | "custom";

export type TerminalConfig =
  | { kind: "kitty-tab"; listenOn?: string }
  | { kind: "terminal-app" }
  | { kind: "custom"; argv: string[] };

export interface UrlShortcut {
  id: string;
  kind: "url";
  label: string;
  url: string;
}

export interface DirShortcut {
  id: string;
  kind: "dir";
  label: string;
  path: string;
  tool: DirTool;
}

export type Shortcut = UrlShortcut | DirShortcut;

export interface Section {
  id: string;
  title: string;
  logo?: string;
  collapsed: boolean;
  shortcuts: Shortcut[];
}

export interface HomepageConfig {
  starred: string[];
  sections: Section[];
  terminal: TerminalConfig;
}

export interface ToolsStatus {
  code: boolean;
  pi: boolean;
  kitten: boolean;
  kitty: boolean;
}

export function isUrlShortcut(shortcut: Shortcut): shortcut is UrlShortcut {
  return shortcut.kind === "url";
}

export function isDirShortcut(shortcut: Shortcut): shortcut is DirShortcut {
  return shortcut.kind === "dir";
}

export const emptyTerminal = (): TerminalConfig => ({ kind: "terminal-app" });

export const emptyConfig = (): HomepageConfig => ({
  starred: [],
  sections: [],
  terminal: emptyTerminal(),
});

function coerceShortcut(raw: Shortcut | Record<string, unknown>): Shortcut {
  const row = raw as Record<string, unknown>;
  const kind = row.kind === "dir" || row.kind === "url" ? row.kind : String(row.path ?? "").trim() ? "dir" : "url";
  if (kind === "dir") {
    return {
      id: String(row.id ?? ""),
      kind: "dir",
      label: String(row.label ?? ""),
      path: String(row.path ?? ""),
      tool: row.tool === "pi" ? "pi" : "code",
    };
  }
  return {
    id: String(row.id ?? ""),
    kind: "url",
    label: String(row.label ?? ""),
    url: String(row.url ?? ""),
  };
}

function coerceTerminal(raw: unknown): TerminalConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return emptyTerminal();
  const row = raw as Record<string, unknown>;
  if (row.kind === "terminal-app") return { kind: "terminal-app" };
  if (row.kind === "kitty-tab") {
    const listenOn = String(row.listenOn ?? "").trim();
    return listenOn ? { kind: "kitty-tab", listenOn } : { kind: "kitty-tab" };
  }
  if (row.kind === "custom" && Array.isArray(row.argv)) {
    const argv = row.argv.filter((item): item is string => typeof item === "string" && item.trim() !== "");
    if (argv.length > 0) return { kind: "custom", argv };
  }
  return emptyTerminal();
}

/** Keep the Links board renderable if an older server omits `kind` / `terminal`. */
export function coerceConfig(raw: unknown): HomepageConfig {
  const row = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const sections = Array.isArray(row.sections)
    ? row.sections.map((item) => {
        const section = item as Record<string, unknown>;
        return {
          id: String(section.id ?? ""),
          title: String(section.title ?? ""),
          logo: typeof section.logo === "string" ? section.logo : undefined,
          collapsed: section.collapsed === true,
          shortcuts: Array.isArray(section.shortcuts)
            ? section.shortcuts.map((shortcut) => coerceShortcut(shortcut as Shortcut))
            : [],
        } satisfies Section;
      })
    : [];
  return {
    starred: Array.isArray(row.starred) ? row.starred.filter((id): id is string => typeof id === "string") : [],
    sections,
    terminal: coerceTerminal(row.terminal),
  };
}

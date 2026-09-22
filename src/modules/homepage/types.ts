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

export function isUrlShortcut(shortcut: Shortcut): shortcut is UrlShortcut {
  return shortcut.kind === "url";
}

export function isDirShortcut(shortcut: Shortcut): shortcut is DirShortcut {
  return shortcut.kind === "dir";
}

export function isDirTool(value: string): value is DirTool {
  return value === "code" || value === "pi";
}

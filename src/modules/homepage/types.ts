export interface UrlShortcut {
  id: string;
  kind: "url";
  label: string;
  url: string;
}

export type Shortcut = UrlShortcut;

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
}

export function isUrlShortcut(shortcut: Shortcut): shortcut is UrlShortcut {
  return shortcut.kind === "url";
}

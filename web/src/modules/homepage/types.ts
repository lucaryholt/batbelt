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

export const emptyConfig = (): HomepageConfig => ({
  starred: [],
  sections: [],
});

function coerceShortcut(raw: Shortcut | Record<string, unknown>): Shortcut {
  const row = raw as Record<string, unknown>;
  return {
    id: String(row.id ?? ""),
    kind: "url",
    label: String(row.label ?? ""),
    url: String(row.url ?? ""),
  };
}

/** Keep the Links board renderable if an older server omits `kind`. */
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
  };
}

export interface Shortcut {
  id: string;
  label: string;
  url: string;
}

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

/** Fixed palette so the same tag string always maps to the same chip colors. */
const PALETTE = [
  { background: "rgba(88, 166, 255, 0.14)", borderColor: "rgba(88, 166, 255, 0.45)", color: "#58a6ff" },
  { background: "rgba(63, 185, 80, 0.14)", borderColor: "rgba(63, 185, 80, 0.45)", color: "#3fb950" },
  { background: "rgba(210, 153, 34, 0.14)", borderColor: "rgba(210, 153, 34, 0.45)", color: "#d29922" },
  { background: "rgba(248, 81, 73, 0.14)", borderColor: "rgba(248, 81, 73, 0.45)", color: "#f85149" },
  { background: "rgba(188, 140, 255, 0.14)", borderColor: "rgba(188, 140, 255, 0.45)", color: "#bc8cff" },
  { background: "rgba(57, 211, 198, 0.14)", borderColor: "rgba(57, 211, 198, 0.45)", color: "#39d3c6" },
  { background: "rgba(255, 123, 184, 0.14)", borderColor: "rgba(255, 123, 184, 0.45)", color: "#ff7bb8" },
  { background: "rgba(163, 113, 247, 0.14)", borderColor: "rgba(163, 113, 247, 0.45)", color: "#a371f7" },
  { background: "rgba(255, 166, 87, 0.14)", borderColor: "rgba(255, 166, 87, 0.45)", color: "#ffa657" },
  { background: "rgba(110, 168, 254, 0.14)", borderColor: "rgba(110, 168, 254, 0.45)", color: "#6ea8fe" },
] as const;

export type TagColors = (typeof PALETTE)[number];

export function tagColor(tag: string): TagColors {
  let h = 0;
  for (let i = 0; i < tag.length; i++) {
    h = (Math.imul(h, 31) + tag.charCodeAt(i)) >>> 0;
  }
  return PALETTE[h % PALETTE.length];
}

export function tagSetKey(tags: string[]): string {
  return [...tags].sort().join("\0");
}

export function sameTagSet(a: string[] | undefined, b: string[] | undefined): boolean {
  return tagSetKey(a ?? []) === tagSetKey(b ?? []);
}

export function matchesTagFilter(tags: string[] | undefined, selected: string[]): boolean {
  if (selected.length === 0) return true;
  const set = new Set(tags ?? []);
  return selected.some((t) => set.has(t));
}

export function collectTags(state: {
  services: { tags?: string[] }[];
  proxy_groups: { services: { tags?: string[] }[] }[];
}): string[] {
  const seen = new Set<string>();
  for (const s of state.services) {
    for (const t of s.tags ?? []) seen.add(t);
  }
  for (const g of state.proxy_groups) {
    for (const s of g.services) {
      for (const t of s.tags ?? []) seen.add(t);
    }
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}

import type { Section, Shortcut } from "./types";

export function normalizeQuery(query: string): string {
  return query.trim().toLowerCase();
}

export type NavDirection = "up" | "down" | "left" | "right";

export interface NavTile {
  id: string;
  top: number;
  left: number;
}

/** Tiles within this many pixels of each other count as one row. */
const ROW_TOLERANCE = 8;

/**
 * Moves the highlight across the rendered grid: left/right stay on the row,
 * up/down land on the nearest column of the adjacent row. Both wrap.
 */
export function nextTileId(tiles: NavTile[], currentId: string, direction: NavDirection): string {
  const index = tiles.findIndex((tile) => tile.id === currentId);
  if (index === -1) return tiles[0]?.id ?? currentId;
  const current = tiles[index];
  const sameRow = (tile: NavTile) => Math.abs(tile.top - current.top) <= ROW_TOLERANCE;

  if (direction === "left" || direction === "right") {
    const row = [...tiles].filter(sameRow).sort((a, b) => a.left - b.left);
    const at = row.findIndex((tile) => tile.id === currentId);
    const neighbour = direction === "left" ? row[at - 1] : row[at + 1];
    if (neighbour) return neighbour.id;
    const step = direction === "left" ? -1 : 1;
    return tiles[(index + step + tiles.length) % tiles.length].id;
  }

  const ahead = tiles.filter((tile) =>
    direction === "up" ? tile.top < current.top - ROW_TOLERANCE : tile.top > current.top + ROW_TOLERANCE,
  );
  const pool = ahead.length > 0 ? ahead : tiles.filter((tile) => !sameRow(tile));
  if (pool.length === 0) return currentId;
  const targetTop =
    direction === "up"
      ? Math.max(...pool.map((tile) => tile.top))
      : Math.min(...pool.map((tile) => tile.top));
  const row = pool.filter((tile) => Math.abs(tile.top - targetTop) <= ROW_TOLERANCE);
  return row.reduce((best, tile) =>
    Math.abs(tile.left - current.left) < Math.abs(best.left - current.left) ? tile : best,
  ).id;
}

export type Matcher = (shortcut: Shortcut, section: Section) => boolean;

function everyTokenIn(haystack: string, tokens: string[]): boolean {
  const text = haystack.toLowerCase();
  return tokens.every((token) => text.includes(token));
}

/**
 * Every whitespace-separated token must match, and names win over URLs: URLs
 * are only consulted when no shortcut matches on label and section title alone.
 * Hosts repeat words like "dev" across environments, so "argo dev" would
 * otherwise return the whole Argo section.
 */
export function buildMatcher(sections: Section[], query: string): Matcher {
  const tokens = normalizeQuery(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return () => true;

  const byName: Matcher = (shortcut, section) =>
    everyTokenIn(`${shortcut.label} ${section.title}`, tokens);
  const named = sections.some((section) =>
    section.shortcuts.some((shortcut) => byName(shortcut, section)),
  );
  if (named) return byName;

  return (shortcut, section) =>
    everyTokenIn(`${shortcut.label} ${shortcutHaystack(shortcut)} ${section.title}`, tokens);
}

function shortcutHaystack(shortcut: Shortcut): string {
  return shortcut.kind === "dir" ? shortcut.path : shortcut.url;
}

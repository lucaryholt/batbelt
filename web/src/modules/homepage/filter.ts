import type { Section, Shortcut } from "./types";
import type { ModuleDescriptor } from "../../shell/types";

export function normalizeQuery(query: string): string {
  return query
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase();
}

export function fuzzyTokenScore(token: string, value: string): number | null {
  const needle = normalizeQuery(token);
  const haystack = normalizeQuery(value);
  if (!needle || !haystack) return null;
  if (needle === haystack) return 1_000;

  const exactAt = haystack.indexOf(needle);
  if (exactAt >= 0) {
    const boundary = exactAt === 0 || /[\s/_.:-]/.test(haystack[exactAt - 1] ?? "");
    return 850 - exactAt * 2 + (exactAt === 0 ? 100 : boundary ? 50 : 0);
  }

  let at = -1;
  let first = -1;
  let gaps = 0;
  let consecutive = 0;
  let longestRun = 0;
  for (const ch of needle) {
    const next = haystack.indexOf(ch, at + 1);
    if (next < 0) return null;
    if (first < 0) first = next;
    if (at >= 0) {
      const gap = next - at - 1;
      gaps += gap;
      consecutive = gap === 0 ? consecutive + 1 : 0;
      longestRun = Math.max(longestRun, consecutive);
    }
    at = next;
  }

  const boundary = first === 0 || /[\s/_.:-]/.test(haystack[first - 1] ?? "");
  const coverage = needle.length / haystack.length;
  const score =
    500 + needle.length * 24 + Math.round(coverage * 100) + longestRun * 18 -
    gaps * 16 - first * 3 + (boundary ? 50 : 0);
  return score >= 340 ? score : null;
}

export function fuzzyTextScore(query: string, value: string): number | null {
  const tokens = normalizeQuery(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  let total = 0;
  for (const token of tokens) {
    const score = fuzzyTokenScore(token, value);
    if (score === null) return null;
    total += score;
  }
  return total;
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

export interface ScoredResult {
  score: number;
  textScore: number;
  order: number;
}

export interface ModulePageResult {
  id: string;
  moduleId: string;
  moduleTitle: string;
  pageId: string;
  pageLabel: string;
  path: string;
  score: number;
  textScore: number;
  order: number;
}

export interface ModuleActionResult {
  id: string;
  moduleId: string;
  moduleTitle: string;
  action: ModuleDescriptor["actions"][number];
  score: number;
  textScore: number;
  order: number;
}

function ranked<T extends ScoredResult>(results: T[]): T[] {
  return results.sort(
    (left, right) =>
      right.score - left.score ||
      right.textScore - left.textScore ||
      left.order - right.order,
  );
}

export function searchModuleActions(
  modules: ModuleDescriptor[],
  query: string,
  usage: Readonly<Record<string, number>> = {},
): ModuleActionResult[] {
  if (!normalizeQuery(query)) return [];

  let order = 0;
  return ranked(modules.flatMap((module) => {
    if (module.id === "homepage") return [];
    return module.actions.flatMap((action) => {
      const id = `action:${module.id}:${action.id}`;
      const searchable = [
        module.title,
        module.id,
        action.label,
        action.id,
        action.description,
        ...(action.keywords ?? []),
      ].join(" ");
      const textScore = fuzzyTextScore(query, searchable);
      const currentOrder = order++;
      if (textScore === null) return [];
      return [{
        id,
        moduleId: module.id,
        moduleTitle: module.title,
        action,
        score: textScore + usageBoost(usage[id] ?? 0),
        textScore,
        order: currentOrder,
      }];
    });
  }));
}

export function searchModulePages(
  modules: ModuleDescriptor[],
  query: string,
  usage: Readonly<Record<string, number>> = {},
): ModulePageResult[] {
  if (!normalizeQuery(query)) return [];

  let order = 0;
  return ranked(modules.flatMap((module) => {
    if (module.id === "homepage") return [];
    return module.pages.flatMap((page) => {
      const id = `page:${module.id}:${page.id}`;
      const path = `/${module.id}/${page.path}`;
      const searchable = `${module.title} ${module.id} ${page.label} ${page.id} ${page.path}`;
      const textScore = fuzzyTextScore(query, searchable);
      const currentOrder = order++;
      if (textScore === null) return [];
      return [{
        id,
        moduleId: module.id,
        moduleTitle: module.title,
        pageId: page.id,
        pageLabel: page.label,
        path,
        score: textScore + usageBoost(usage[id] ?? 0),
        textScore,
        order: currentOrder,
      }];
    });
  }));
}

export interface ShortcutResult extends ScoredResult {
  id: string;
  shortcut: Shortcut;
  section: Section;
}

export function shortcutUsageKey(shortcutId: string): string {
  return `shortcut:${shortcutId}`;
}

export function usageBoost(count: number): number {
  return Math.min(180, Math.round(Math.log2(Math.max(0, count) + 1) * 30));
}

export function searchShortcuts(
  sections: Section[],
  query: string,
  usage: Readonly<Record<string, number>> = {},
): ShortcutResult[] {
  if (!normalizeQuery(query)) return [];
  let order = 0;
  const candidates = sections.flatMap((section) =>
    section.shortcuts.map((shortcut) => ({
      id: shortcutUsageKey(shortcut.id),
      shortcut,
      section,
      order: order++,
      nameScore: fuzzyTextScore(query, `${shortcut.label} ${section.title}`),
      urlScore: fuzzyTextScore(query, `${shortcut.label} ${section.title} ${shortcut.url}`),
    })),
  );
  const useNames = candidates.some((candidate) => candidate.nameScore !== null);
  return ranked(candidates.flatMap((candidate) => {
    const textScore = useNames ? candidate.nameScore : candidate.urlScore;
    if (textScore === null) return [];
    return [{
      id: candidate.id,
      shortcut: candidate.shortcut,
      section: candidate.section,
      textScore,
      score: textScore + usageBoost(usage[candidate.id] ?? 0),
      order: candidate.order,
    }];
  }));
}

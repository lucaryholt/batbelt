import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

export function expandUserPath(value: string, home = homedir()): string {
  const trimmed = value.trim();
  if (trimmed === "~") return home;
  if (trimmed.startsWith("~/")) return join(home, trimmed.slice(2));
  return trimmed;
}

export function expandListenOn(value: string, home = homedir()): string {
  const withHome = value.replaceAll("${HOME}", home).replaceAll("$HOME", home);
  return expandUserPath(withHome, home);
}

export function isExpandedAbsolute(value: string, home = homedir()): boolean {
  return isAbsolute(expandUserPath(value, home));
}

export function joinSecretPath(prefix: string, entry: string): string {
  const next = entry.replace(/\/$/, "");
  if (!prefix) return next;
  return `${prefix.replace(/\/$/, "")}/${next}`;
}

export function listedPaths(results: Record<string, { data?: string[] }>): string[] {
  const names = new Set<string>();
  for (const result of Object.values(results)) {
    for (const key of result.data ?? []) names.add(key);
  }
  return [...names].sort();
}

export function envErrors(
  results: Record<string, { ok: boolean; missing?: boolean; error?: string }>,
): string[] {
  return Object.entries(results)
    .filter(([, result]) => !result.ok && !result.missing)
    .map(([name, result]) => `${name}: ${result.error || "failed"}`);
}

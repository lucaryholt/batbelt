import type { Environment, EnvResult } from "../types";
import { envErrors, joinSecretPath, listedPaths } from "../lib/paths";

export function PathBrowser({
  envs,
  path,
  results,
  query = "",
  onOpenFolder,
  onOpenSecret,
}: {
  envs: Environment[];
  path: string;
  results: Record<string, EnvResult<string[]>>;
  query?: string;
  onOpenFolder: (nextPath: string) => void;
  onOpenSecret: (nextPath: string) => void;
}) {
  const allEntries = listedPaths(results);
  const needle = query.trim().toLowerCase();
  const entries = needle
    ? allEntries.filter((entry) => entry.toLowerCase().includes(needle))
    : allEntries;
  const errors = envErrors(results);

  return (
    <section className="card">
      <table className="grid-table">
        <thead>
          <tr>
            <th>Path</th>
            {envs.map((env) => (
              <th key={env.name}>{env.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => {
            const present = envs.map((env) => (results[env.name]?.data ?? []).includes(entry));
            const drifted = new Set(present).size > 1;
            const folder = entry.endsWith("/");
            return (
              <tr key={entry} className={drifted ? "diff" : undefined}>
                <td
                  className="mono clickable"
                  onClick={() => {
                    const next = joinSecretPath(path, entry);
                    if (folder) onOpenFolder(next);
                    else onOpenSecret(next);
                  }}
                >
                  {entry}
                </td>
                {present.map((exists, index) => (
                  <td key={envs[index].name}>
                    {exists ? "present" : <span className="missing">missing</span>}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      {errors.length > 0 && (
        <div className="banner bad" style={{ marginTop: 12 }}>
          {errors.join(" · ")}
        </div>
      )}
      {allEntries.length === 0 && errors.length === 0 && <p className="muted">Nothing listed at this prefix.</p>}
      {allEntries.length > 0 && entries.length === 0 && (
        <p className="muted">No paths match “{query.trim()}”.</p>
      )}
    </section>
  );
}

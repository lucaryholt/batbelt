import { useMemo, useState } from "react";
import type { AppConfig, EnvResult, EnvStatus, SecretData } from "../types";
import { checkExists, getSecrets, listSecrets, loginEnv, writeSecrets } from "../api";
import { PathBrowser } from "../components/PathBrowser";
import { envErrors } from "../lib/paths";

function allLoadedKeys(results: Record<string, EnvResult<SecretData>>): string[] {
  const keys = new Set<string>();
  for (const result of Object.values(results)) {
    if (result.data) {
      for (const key of Object.keys(result.data)) keys.add(key);
    }
  }
  return [...keys].sort();
}

function valuesDiffer(values: Record<string, Record<string, string>>, key: string, envNames: string[]): boolean {
  const set = new Set(envNames.map((name) => values[key]?.[name] ?? ""));
  return set.size > 1;
}

interface WriteSummary {
  path: string;
  keys: string[];
  envs: { name: string; mode: "create" | "overwrite" }[];
}

export function SecretsPage({
  config,
  status,
  onRefresh,
}: {
  config: AppConfig;
  status: EnvStatus[];
  onRefresh: () => Promise<void>;
}) {
  const envs = config.environments;
  const defaultMount = useMemo(() => {
    const mounts = new Set(envs.map((env) => env.kvMount || "secret"));
    return mounts.size === 1 ? [...mounts][0] : envs[0]?.kvMount || "secret";
  }, [envs]);

  const [mount, setMount] = useState(defaultMount);
  const [path, setPath] = useState("");
  const [keys, setKeys] = useState<string[]>([""]);
  const [values, setValues] = useState<Record<string, Record<string, string>>>({});
  const [selected, setSelected] = useState<string[]>(envs.map((env) => env.name));
  const [loadFrom, setLoadFrom] = useState(envs[0]?.name ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<WriteSummary | null>(null);
  const [listResults, setListResults] = useState<Record<string, EnvResult<string[]>> | null>(null);
  const [compareResults, setCompareResults] = useState<Record<string, EnvResult<SecretData>> | null>(null);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [revealAll, setRevealAll] = useState(false);
  const [loginLogs, setLoginLogs] = useState<string[]>([]);
  const [loginCurrent, setLoginCurrent] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const loggedOut = status.filter((env) => !env.loggedIn);
  const loggingIn = loginCurrent !== null;
  const needle = query.trim().toLowerCase();
  const visibleIndexes = keys
    .map((key, index) => ({ key, index }))
    .filter(({ key }) => !needle || key.toLowerCase().includes(needle))
    .map(({ index }) => index);

  function setKeyName(index: number, name: string) {
    const previous = keys[index];
    setKeys((current) => current.map((key, i) => (i === index ? name : key)));
    if (previous === name) return;
    setValues((current) => {
      if (!current[previous]) return current;
      const next = { ...current };
      next[name] = { ...(next[name] ?? {}), ...next[previous] };
      delete next[previous];
      return next;
    });
  }

  function setCell(key: string, envName: string, value: string) {
    setValues((current) => ({
      ...current,
      [key]: { ...(current[key] ?? {}), [envName]: value },
    }));
  }

  function applyLoaded(results: Record<string, EnvResult<SecretData>>, envName?: string) {
    const nextKeys = envName
      ? Object.keys(results[envName]?.data ?? {})
      : allLoadedKeys(results);
    setKeys(nextKeys.length ? nextKeys : [""]);
    setValues((current) => {
      const next = { ...current };
      const names = envName ? [envName] : envs.map((env) => env.name);
      for (const key of nextKeys) {
        next[key] = { ...(next[key] ?? {}) };
        for (const name of names) {
          const data = results[name]?.data;
          if (data && key in data) next[key][name] = data[key];
        }
      }
      return next;
    });
    setCompareResults(results);
    setRevealed({});
    setRevealAll(false);
  }

  async function loadExisting(nextPath = path, envName = loadFrom) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await getSecrets(mount, nextPath);
      if (envName) {
        const result = response.results[envName];
        if (!result?.ok || !result.data) {
          throw new Error(result?.error || `Could not load ${nextPath} from ${envName}`);
        }
      }
      applyLoaded(response.results, envName || undefined);
      const count = envName
        ? Object.keys(response.results[envName]?.data ?? {}).length
        : allLoadedKeys(response.results).length;
      setMessage(`Loaded ${count} key${count === 1 ? "" : "s"}${envName ? ` from ${envName}` : ""}.`);
      setPath(nextPath);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function runBrowseAt(nextPath = path) {
    setBusy(true);
    setError(null);
    try {
      const response = await listSecrets(mount, nextPath);
      setListResults(response.results);
      setPath(nextPath);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function pickSecret(nextPath: string) {
    setPath(nextPath);
    setListResults(null);
    await loadExisting(nextPath, "");
  }

  async function loginAll() {
    const targets = loggedOut.map((env) => env.name);
    if (!targets.length) return;
    setError(null);
    setMessage(null);
    setLoginLogs([]);
    try {
      for (const name of targets) {
        setLoginCurrent(name);
        setLoginLogs((current) => [...current, `--- ${name} ---`]);
        await loginEnv(name, (event) => {
          if (event.line) setLoginLogs((current) => [...current, event.line!]);
        }).done;
        await onRefresh();
        setLoginLogs((current) => [...current, `Logged in to ${name}.`]);
      }
      setMessage(`Logged in to ${targets.join(", ")}.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoginCurrent(null);
    }
  }

  function payload(): Record<string, SecretData> {
    const out: Record<string, SecretData> = {};
    for (const envName of selected) {
      const data: SecretData = {};
      for (const key of keys) {
        const trimmed = key.trim();
        if (!trimmed) continue;
        data[trimmed] = values[key]?.[envName] ?? "";
      }
      out[envName] = data;
    }
    return out;
  }

  async function requestWrite() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const valuesByEnv = payload();
      if (!path.trim()) throw new Error("Path is required");
      if (!Object.keys(valuesByEnv).length) throw new Error("Select at least one environment");
      const keyList = keys.map((key) => key.trim()).filter(Boolean);
      if (!keyList.length) throw new Error("Add at least one key");
      const exists = await checkExists(mount, path, Object.keys(valuesByEnv));
      setConfirm({
        path,
        keys: keyList,
        envs: Object.keys(valuesByEnv).map((name) => ({
          name,
          mode: exists.exists[name] ? "overwrite" : "create",
        })),
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmWrite() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await writeSecrets({
        mount,
        path,
        values: payload(),
        confirm: true,
      });
      const failed = Object.entries(response.results).filter(([, result]) => !result.ok);
      if (failed.length) {
        setError(failed.map(([name, result]) => `${name}: ${result.error || "write failed"}`).join(" · "));
      } else {
        setMessage(`Wrote ${path} to ${Object.keys(response.results).join(", ")}.`);
      }
      setConfirm(null);
      await onRefresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!envs.length) {
    return (
      <div className="card">
        <p>Add your OpenBao environments in Settings first.</p>
      </div>
    );
  }

  const loginLabel = loggingIn
    ? `Logging in to ${loginCurrent}…`
    : loggedOut.length === envs.length
      ? "Log in to all environments"
      : `Log in to ${loggedOut.map((env) => env.name).join(", ")}`;

  return (
    <div className="stack">
      {loggedOut.length > 0 && (
        <div className="banner warn">Not logged in to {loggedOut.map((env) => env.name).join(", ")}.</div>
      )}
      {message && <div className="banner ok">{message}</div>}
      {error && <div className="banner bad">{error}</div>}
      {loggedOut.length > 0 && (
        <section className="card">
          <div className="env-card-head">
            <div>
              <strong>OIDC login</strong>
              <p className="muted" style={{ margin: "4px 0 0" }}>
                Completes one environment, then starts the next. The IdP opens in your browser.
              </p>
            </div>
            <button className="btn primary" disabled={loggingIn} onClick={() => void loginAll()}>
              {loginLabel}
            </button>
          </div>
          {loginLogs.length > 0 && <pre className="log">{loginLogs.join("\n")}</pre>}
        </section>
      )}
      {loggedOut.length === 0 && loginLogs.length > 0 && <pre className="log">{loginLogs.join("\n")}</pre>}

      <section className="card">
        <div className="row">
          <label className="field narrow">
            Mount
            <input value={mount} onChange={(e) => setMount(e.target.value)} />
          </label>
          <label className="field">
            Path
            <input
              className="mono"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="apps/my-service"
            />
          </label>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <label className="field">
            Load from
            <select value={loadFrom} onChange={(e) => setLoadFrom(e.target.value)}>
              <option value="">All environments</option>
              {envs.map((env) => (
                <option key={env.name} value={env.name}>
                  {env.name}
                </option>
              ))}
            </select>
          </label>
          <button className="btn" disabled={busy || !path || loggingIn} onClick={() => void loadExisting()}>
            Load existing secret
          </button>
          <button className="btn" disabled={busy || loggingIn} onClick={() => void runBrowseAt(path)}>
            Browse paths
          </button>
          {compareResults && (
            <button className="btn" onClick={() => setRevealAll((value) => !value)}>
              {revealAll ? "Hide values" : "Show all values"}
            </button>
          )}
        </div>
        <div className="checkbox-row" style={{ marginTop: 16 }}>
          {envs.map((env) => (
            <label key={env.name}>
              <input
                type="checkbox"
                checked={selected.includes(env.name)}
                onChange={(e) => {
                  setSelected((current) =>
                    e.target.checked ? [...current, env.name] : current.filter((name) => name !== env.name),
                  );
                }}
              />
              Write to {env.name}
            </label>
          ))}
        </div>
        <label className="field" style={{ marginTop: 16 }}>
          Search
          <input
            className="mono"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter paths and key names"
          />
        </label>
      </section>

      {listResults && (
        <PathBrowser
          envs={envs}
          path={path}
          results={listResults}
          query={query}
          onOpenFolder={(next) => void runBrowseAt(next)}
          onOpenSecret={(next) => void pickSecret(next)}
        />
      )}

      {compareResults && envErrors(compareResults).length > 0 && (
        <div className="banner bad">{envErrors(compareResults).join(" · ")}</div>
      )}

      <section className="card">
        <table className="grid-table">
          <thead>
            <tr>
              <th>Key</th>
              {envs.map((env) => (
                <th key={env.name}>{env.name}</th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {visibleIndexes.map((index) => {
              const key = keys[index];
              const open = revealAll || revealed[key] || !key;
              const rowDiff = key.trim() !== "" && valuesDiffer(values, key, envs.map((env) => env.name));
              return (
                <tr key={index} className={rowDiff ? "diff" : undefined}>
                  <td>
                    <input
                      className="mono"
                      value={key}
                      placeholder="api_key"
                      onChange={(e) => setKeyName(index, e.target.value)}
                    />
                  </td>
                  {envs.map((env) => (
                    <td key={env.name}>
                      <input
                        className="mono"
                        type={open ? "text" : "password"}
                        value={values[key]?.[env.name] ?? ""}
                        onChange={(e) => setCell(key, env.name, e.target.value)}
                      />
                    </td>
                  ))}
                  <td>
                    <div className="actions">
                      <button
                        className="btn small"
                        onClick={() => setRevealed((current) => ({ ...current, [key]: !current[key] }))}
                      >
                        {open ? "Hide" : "Show"}
                      </button>
                      <button className="btn small danger" onClick={() => {
                        const name = keys[index];
                        setKeys((current) => current.filter((_, i) => i !== index));
                        setValues((current) => {
                          const next = { ...current };
                          delete next[name];
                          return next;
                        });
                      }}>
                        Remove
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {keys.length > 0 && visibleIndexes.length === 0 && (
          <p className="muted" style={{ marginTop: 12 }}>
            No keys match “{query.trim()}”. Writes still include every key.
          </p>
        )}
        <div className="actions" style={{ marginTop: 16 }}>
          <button className="btn" onClick={() => setKeys((current) => [...current, ""])}>
            Add key
          </button>
          <button className="btn primary" disabled={busy || loggingIn} onClick={() => void requestWrite()}>
            Write to selected environments
          </button>
        </div>
      </section>

      {confirm && (
        <div className="modal-backdrop">
          <div className="modal">
            <h2>Confirm secret write</h2>
            <p>
              Write <code>{confirm.path}</code> to {confirm.envs.length} environment
              {confirm.envs.length === 1 ? "" : "s"}.
            </p>
            <ul className="confirm-list">
              {confirm.envs.map((env) => (
                <li key={env.name}>
                  <strong>{env.name}</strong> — {env.mode === "overwrite" ? "overwrite existing" : "create new"}
                </li>
              ))}
            </ul>
            <p className="muted">Keys: {confirm.keys.join(", ")}</p>
            <div className="actions">
              <button className="btn" onClick={() => setConfirm(null)}>
                Cancel
              </button>
              <button className="btn primary" disabled={busy} onClick={() => void confirmWrite()}>
                Confirm write
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import { useMemo, useState } from "react";
import type { AppConfig, EnvResult, EnvStatus, SecretData, WritePreviewResponse } from "../types";
import { approveWrite, getSecrets, listSecrets, loginEnv, previewWrite, rejectWrite } from "../api";
import { PathBrowser } from "../components/PathBrowser";
import { openBaoSecretUrl } from "../lib/openbao-url";
import { envErrors } from "../lib/paths";

type SecretSets = Record<string, SecretData>;
type ChangeKind = "added" | "changed" | "removed";

interface SecretChange {
  environment: string;
  key: string;
  kind: ChangeKind;
  before?: string;
  after?: string;
}

function allLoadedKeys(results: Record<string, EnvResult<SecretData>>): string[] {
  const keys = new Set<string>();
  for (const result of Object.values(results)) {
    if (result.data) {
      for (const key of Object.keys(result.data)) keys.add(key);
    }
  }
  return [...keys].sort();
}

function valuesDiffer(drafts: SecretSets, key: string, envNames: string[]): boolean {
  const set = new Set(
    envNames.map((name) =>
      Object.hasOwn(drafts[name] ?? {}, key) ? drafts[name][key] : Symbol.for("missing"),
    ),
  );
  return set.size > 1;
}

function cloneSecretSets(source: SecretSets): SecretSets {
  return Object.fromEntries(
    Object.entries(source).map(([name, data]) => [name, { ...data }]),
  );
}

export function changesFor(
  baseline: SecretSets,
  drafts: SecretSets,
  envNames: string[],
): SecretChange[] {
  const changes: SecretChange[] = [];
  for (const environment of envNames) {
    const before = baseline[environment] ?? {};
    const after = drafts[environment] ?? {};
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of [...keys].sort()) {
      const hadBefore = Object.hasOwn(before, key);
      const hasAfter = Object.hasOwn(after, key);
      if (!hadBefore && hasAfter) {
        changes.push({ environment, key, kind: "added", after: after[key] });
      } else if (hadBefore && !hasAfter) {
        changes.push({ environment, key, kind: "removed", before: before[key] });
      } else if (before[key] !== after[key]) {
        changes.push({
          environment,
          key,
          kind: "changed",
          before: before[key],
          after: after[key],
        });
      }
    }
  }
  return changes;
}

export function changedEnvironments(changes: SecretChange[]): string[] {
  return [...new Set(changes.map((change) => change.environment))];
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
  const [keys, setKeys] = useState<string[]>([]);
  const [baseline, setBaseline] = useState<SecretSets>({});
  const [drafts, setDrafts] = useState<SecretSets>({});
  const [loadFrom, setLoadFrom] = useState(envs[0]?.name ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [listResults, setListResults] = useState<Record<string, EnvResult<string[]>> | null>(null);
  const [compareResults, setCompareResults] = useState<Record<string, EnvResult<SecretData>> | null>(null);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [revealAll, setRevealAll] = useState(false);
  const [loginLogs, setLoginLogs] = useState<string[]>([]);
  const [loginCurrent, setLoginCurrent] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selectedEnvs, setSelectedEnvs] = useState<Record<string, boolean>>(
    Object.fromEntries(envs.map((env) => [env.name, true])),
  );
  const [reviewChanges, setReviewChanges] = useState<SecretChange[] | null>(null);
  const [preview, setPreview] = useState<WritePreviewResponse | null>(null);

  const loggedOut = status.filter((env) => !env.loggedIn);
  const loggingIn = loginCurrent !== null;
  const needle = query.trim().toLowerCase();
  const visibleIndexes = keys
    .map((key, index) => ({ key, index }))
    .filter(({ key }) => !needle || key.toLowerCase().includes(needle))
    .map(({ index }) => index);

  function applyLoaded(results: Record<string, EnvResult<SecretData>>, envName?: string) {
    const names = envName ? [envName] : envs.map((env) => env.name);
    const nextSecrets = Object.fromEntries(
      names.map((name) => [name, { ...(results[name]?.data ?? {}) }]),
    );
    const nextKeys = [...new Set(Object.values(nextSecrets).flatMap(Object.keys))].sort();
    setKeys(nextKeys);
    setBaseline(cloneSecretSets(nextSecrets));
    setDrafts(cloneSecretSets(nextSecrets));
    setCompareResults(results);
    setRevealed({});
    setRevealAll(false);
  }

  async function loadExisting(nextPath = path, envName = loadFrom) {
    if (preview) await discardPreview();
    setReviewChanges(null);
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
    if (preview) await discardPreview();
    setReviewChanges(null);
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

  async function discardPreview() {
    if (!preview) return;
    const approvalId = preview.approvalId;
    setPreview(null);
    try {
      await rejectWrite(approvalId);
    } catch {
      // The server also expires abandoned previews.
    }
  }

  function requestWrite() {
    const selected = envs.filter((env) => selectedEnvs[env.name]);
    if (!path.trim()) {
      setError("Path is required.");
      return;
    }
    if (keys.some((key) => !key.trim())) {
      setError("Secret keys cannot be empty.");
      return;
    }
    if (!selected.length) {
      setError("Select at least one environment.");
      return;
    }
    setError(null);
    setMessage(null);
    const changes = changesFor(baseline, drafts, selected.map((env) => env.name));
    if (!changes.length) {
      setError("There are no changes to review.");
      return;
    }
    setReviewChanges(changes);
  }

  async function continueToCommands() {
    if (!reviewChanges) return;
    const selectedNames = changedEnvironments(reviewChanges);
    setBusy(true);
    setError(null);
    try {
      const data = Object.fromEntries(
        selectedNames.map((name) => [name, { ...(drafts[name] ?? {}) }]),
      );
      setPreview(await previewWrite({ mount, path, values: data }));
      setReviewChanges(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function approvePreview() {
    if (!preview) return;
    const approvalId = preview.approvalId;
    setBusy(true);
    setError(null);
    try {
      const response = await approveWrite(approvalId);
      setPreview(null);
      const failures = Object.entries(response.results)
        .filter(([, result]) => !result.ok)
        .map(([name, result]) => `${name}: ${result.error || "write failed"}`);
      if (failures.length) throw new Error(failures.join(" · "));
      setMessage(`Wrote secret to ${Object.keys(response.results).join(", ")}.`);
      await loadExisting(path, "");
    } catch (err) {
      setPreview(null);
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
        <div className="actions" style={{ marginTop: 16 }}>
          {envs.map((env) => (
            path.trim() ? (
              <a
                key={env.name}
                className="btn"
                href={openBaoSecretUrl({
                  addr: env.addr,
                  mount,
                  path,
                  namespace: env.namespace,
                })}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open {env.name} in OpenBao
              </a>
            ) : (
              <button key={env.name} className="btn" disabled>
                Open {env.name} in OpenBao
              </button>
            )
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
        <div className="checkbox-row" style={{ marginBottom: 12 }}>
          {envs.map((env) => (
            <label key={env.name}>
              <input
                type="checkbox"
                checked={selectedEnvs[env.name] ?? false}
                onChange={(event) =>
                  setSelectedEnvs((current) => ({ ...current, [env.name]: event.target.checked }))
                }
              />
              Write {env.name}
            </label>
          ))}
        </div>
        <div className="key-list">
          {visibleIndexes.map((index) => {
            const key = keys[index];
            const open = revealAll || revealed[key] || !key;
            const rowDiff = key.trim() !== "" && valuesDiffer(drafts, key, envs.map((env) => env.name));
            const changed = envs.some((env) =>
              changesFor(baseline, drafts, [env.name]).some((change) => change.key === key),
            );
            return (
              <details key={index} className={rowDiff ? "key-row diff" : "key-row"}>
                <summary>
                  <code>{key}</code>
                  {rowDiff && <span className="key-diff-mark">differs</span>}
                  {changed && <span className="key-change-mark">changed</span>}
                  <button
                    className="btn small"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setRevealed((current) => ({ ...current, [key]: !current[key] }));
                    }}
                  >
                    {open ? "Hide" : "Show"}
                  </button>
                </summary>
                <div className="key-envs">
                  {envs.map((env) => {
                    const present = Object.hasOwn(drafts[env.name] ?? {}, key);
                    return (
                      <div key={env.name} className="field">
                        <span>{env.name}</span>
                        {present ? (
                          <div className="st-value-edit">
                            <input
                              className="mono"
                              type={open ? "text" : "password"}
                              value={drafts[env.name]?.[key] ?? ""}
                              autoCorrect="off"
                              autoCapitalize="none"
                              spellCheck={false}
                              onChange={(event) =>
                                setDrafts((current) => ({
                                  ...current,
                                  [env.name]: {
                                    ...(current[env.name] ?? {}),
                                    [key]: event.target.value,
                                  },
                                }))
                              }
                              aria-label={`${key} in ${env.name}`}
                            />
                            <button
                              className="btn small danger"
                              onClick={() =>
                                setDrafts((current) => {
                                  const data = { ...(current[env.name] ?? {}) };
                                  delete data[key];
                                  return { ...current, [env.name]: data };
                                })
                              }
                            >
                              Remove
                            </button>
                          </div>
                        ) : (
                          <button
                            className="btn small"
                            onClick={() =>
                              setDrafts((current) => ({
                                ...current,
                                [env.name]: { ...(current[env.name] ?? {}), [key]: "" },
                              }))
                            }
                          >
                            Add to {env.name}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </details>
            );
          })}
        </div>
        {keys.length > 0 && visibleIndexes.length === 0 && (
          <p className="muted" style={{ marginTop: 12 }}>
            No keys match “{query.trim()}”.
          </p>
        )}
        {keys.length === 0 && (
          <p className="muted" style={{ marginTop: 12 }}>
            Load an existing secret to compare its values.
          </p>
        )}
        <div className="actions" style={{ marginTop: 12 }}>
          <button
            className="btn"
            onClick={() => {
              const key = `new-key-${keys.length + 1}`;
              setKeys((current) => [...current, key]);
            }}
          >
            Add key
          </button>
          <button className="btn primary" disabled={busy || loggingIn} onClick={requestWrite}>
            Review changes
          </button>
        </div>
      </section>

      {reviewChanges && (
        <div className="st-modal-backdrop" role="presentation">
          <section className="card st-modal" role="dialog" aria-modal="true" aria-labelledby="changes-title">
            <h2 id="changes-title">Step 1 of 2: Review changed values</h2>
            <p>Only the following values will change. Missing keys stay missing unless explicitly added.</p>
            <div className="st-change-list">
              {envs.map((env) => {
                const changes = reviewChanges.filter((change) => change.environment === env.name);
                if (!changes.length) return null;
                return (
                  <div key={env.name}>
                    <strong>{env.name}</strong>
                    {changes.map((change) => (
                      <div className="st-change" key={`${change.environment}:${change.key}`}>
                        <code>{change.key}</code>
                        <span className="key-diff-mark">{change.kind}</span>
                        {change.before !== undefined && (
                          <div><span className="muted">Before</span><pre className="log">{change.before}</pre></div>
                        )}
                        {change.after !== undefined && (
                          <div><span className="muted">After</span><pre className="log">{change.after}</pre></div>
                        )}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
            <div className="actions">
              <button className="btn" disabled={busy} onClick={() => setReviewChanges(null)}>
                Back
              </button>
              <button className="btn primary" disabled={busy} onClick={() => void continueToCommands()}>
                Continue to commands
              </button>
            </div>
          </section>
        </div>
      )}

      {preview && (
        <div className="st-modal-backdrop" role="presentation">
          <section className="card st-modal" role="dialog" aria-modal="true" aria-labelledby="write-title">
            <h2 id="write-title">Step 2 of 2: Approve commands</h2>
            <p>
              These exact commands will run in order. A later failure cannot undo earlier writes.
            </p>
            <div className="st-command-list">
              {preview.commands.map((item) => (
                <div key={item.environment}>
                  <strong>{item.environment}</strong>
                  <pre className="log">{item.command}</pre>
                </div>
              ))}
            </div>
            <div className="actions">
              <button className="btn" disabled={busy} onClick={() => void discardPreview()}>
                Reject
              </button>
              <button className="btn danger" disabled={busy} onClick={() => void approvePreview()}>
                Approve and run
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

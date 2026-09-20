import { useState } from "react";
import type { AppConfig, Environment, EnvStatus, HealthResponse } from "../types";
import { loginEnv, logoutEnv, saveConfig } from "../api";

const blankEnv = (): Environment => ({
  name: "",
  addr: "",
  namespace: "",
  oidcMount: "oidc",
  oidcRole: "",
  kvMount: "secret",
});

function formatTtl(ttl?: number): string {
  if (ttl == null) return "";
  if (ttl < 60) return `${ttl}s left`;
  if (ttl < 3600) return `${Math.round(ttl / 60)}m left`;
  return `${Math.round(ttl / 3600)}h left`;
}

export function SettingsPage({
  config,
  status,
  health,
  onChange,
}: {
  config: AppConfig;
  status: EnvStatus[];
  health: HealthResponse | null;
  onChange: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<Environment[]>(
    config.environments.length ? config.environments : [blankEnv(), blankEnv(), blankEnv()],
  );
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loginLogs, setLoginLogs] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmSave, setConfirmSave] = useState(false);

  const statusByName = new Map(status.map((item) => [item.name, item]));
  const pending = draft.filter((env) => env.name.trim() && env.addr.trim());

  function update(index: number, patch: Partial<Environment>) {
    setDraft((current) => current.map((env, i) => (i === index ? { ...env, ...patch } : env)));
  }

  async function onSave() {
    setError(null);
    setMessage(null);
    try {
      await saveConfig({ environments: pending });
      setDraft(pending.length ? pending : [blankEnv()]);
      await onChange();
      setConfirmSave(false);
      setMessage(`Saved ${pending.length} environment${pending.length === 1 ? "" : "s"}.`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function onLogin(name: string) {
    setBusy(name);
    setError(null);
    setLoginLogs((current) => ({ ...current, [name]: [] }));
    try {
      await loginEnv(name, (event) => {
        if (event.line) {
          setLoginLogs((current) => ({
            ...current,
            [name]: [...(current[name] ?? []), event.line!],
          }));
        }
      }).done;
      await onChange();
      setMessage(`Logged in to ${name}.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function onLogout(name: string) {
    setBusy(name);
    setError(null);
    try {
      await logoutEnv(name);
      await onChange();
      setMessage(`Logged out of ${name}.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="stack">
      {health?.baoAvailable && (
        <div className="banner ok">Using {health.baoVersion ?? "bao"} on this machine.</div>
      )}
      {message && <div className="banner ok">{message}</div>}
      {error && <div className="banner bad">{error}</div>}
      <p className="muted">
        Config is stored at <code>~/.config/batbelt/steamer/config.yaml</code>. Tokens stay in{" "}
        <code>~/.config/batbelt/steamer/tokens/</code> so they never overwrite <code>~/.vault-token</code>.
      </p>
      {draft.map((env, index) => {
        const live = statusByName.get(env.name);
        return (
          <section className="card env-card" key={`${env.name}-${index}`}>
            <div className="env-card-head">
              <strong>{env.name || `Environment ${index + 1}`}</strong>
              <div className="actions">
                {live && (
                  <span className="st-pill">
                    <span className={`dot ${live.loggedIn ? "ok" : "bad"}`} />
                    {live.loggedIn
                      ? `${live.displayName ?? "logged in"} ${formatTtl(live.ttl)}`.trim()
                      : "not logged in"}
                  </span>
                )}
                <button
                  className="btn small"
                  disabled={!env.name || busy !== null}
                  onClick={() => void onLogin(env.name)}
                >
                  {busy === env.name ? "Waiting for OIDC…" : "Log in"}
                </button>
                <button
                  className="btn small"
                  disabled={!env.name || busy !== null}
                  onClick={() => void onLogout(env.name)}
                >
                  Log out
                </button>
                <button
                  className="btn small danger"
                  onClick={() => setDraft((current) => current.filter((_, i) => i !== index))}
                >
                  Remove
                </button>
              </div>
            </div>
            <div className="row">
              <label className="field narrow">
                Name
                <input value={env.name} onChange={(e) => update(index, { name: e.target.value })} placeholder="dev" />
              </label>
              <label className="field">
                Address
                <input
                  value={env.addr}
                  onChange={(e) => update(index, { addr: e.target.value })}
                  placeholder="https://bao-dev.example.com"
                />
              </label>
            </div>
            <div className="row">
              <label className="field">
                Namespace
                <input value={env.namespace ?? ""} onChange={(e) => update(index, { namespace: e.target.value })} />
              </label>
              <label className="field">
                KV mount
                <input value={env.kvMount ?? "secret"} onChange={(e) => update(index, { kvMount: e.target.value })} />
              </label>
              <label className="field">
                OIDC mount
                <input value={env.oidcMount ?? "oidc"} onChange={(e) => update(index, { oidcMount: e.target.value })} />
              </label>
              <label className="field">
                OIDC role
                <input value={env.oidcRole ?? ""} onChange={(e) => update(index, { oidcRole: e.target.value })} />
              </label>
            </div>
            {(loginLogs[env.name] ?? []).length > 0 && (
              <pre className="log">{loginLogs[env.name].join("\n")}</pre>
            )}
          </section>
        );
      })}
      <div className="actions">
        <button className="btn" onClick={() => setDraft((current) => [...current, blankEnv()])}>
          Add environment
        </button>
        <button className="btn primary" onClick={() => setConfirmSave(true)}>
          Save settings
        </button>
      </div>
      {confirmSave && (
        <div className="modal-backdrop">
          <div className="modal">
            <h2>Save Steamer settings?</h2>
            {pending.length === 0 ? (
              <p>This will save an empty environment list.</p>
            ) : (
              <ul className="confirm-list">
                {pending.map((env) => (
                  <li key={env.name}>
                    <strong>{env.name}</strong> — {env.addr}
                  </li>
                ))}
              </ul>
            )}
            <div className="actions">
              <button className="btn" onClick={() => setConfirmSave(false)}>
                Cancel
              </button>
              <button className="btn primary" onClick={() => void onSave()}>
                Confirm save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

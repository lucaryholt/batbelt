import { useCallback, useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { getConfig, getHealth, getInbox, openConfig, reloadConfig } from "./api";
import { InboxPage } from "./pages/Inbox";
import type { ConfigResponse, HealthResponse, InboxResponse } from "./types";
import { useToast } from "../../shell/toast";
import "./prlooker.css";

export function PrlookerApp() {
  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [inbox, setInbox] = useState<InboxResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const { flash } = useToast();

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const [nextConfig, nextHealth] = await Promise.all([getConfig(), getHealth()]);
      setConfig(nextConfig);
      setHealth(nextHealth);
      if (!nextHealth.ghAvailable || !nextHealth.loggedIn) {
        setInbox(null);
        setError(null);
        return;
      }
      try {
        setInbox(await getInbox());
        setError(null);
      } catch (err) {
        setError((err as Error).message);
      }
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void refresh()
      .catch((err: Error) => setError(err.message))
      .finally(() => setReady(true));
  }, [refresh]);

  const ghOk = health?.ghAvailable && health.loggedIn;

  return (
    <div className="prlooker-app">
      <header>
        <span className="logo">pr looker</span>
        <div className="header-actions">
          <button
            className="btn small"
            disabled={busy}
            onClick={() => {
              void refresh().catch((err: Error) => flash(err.message, true));
            }}
          >
            Refresh
          </button>
          <button
            className="btn small"
            onClick={() => {
              void openConfig()
                .then((res) => flash(`Opened ${res.path}`))
                .catch((err: Error) => flash(err.message, true));
            }}
          >
            Open YAML
          </button>
          <button
            className="btn small"
            onClick={() => {
              void reloadConfig()
                .then((next) => {
                  setConfig(next);
                  flash("Reloaded config");
                  return refresh();
                })
                .catch((err: Error) => flash(err.message, true));
            }}
          >
            Reload config
          </button>
        </div>
        {health && (
          <span className="st-pill">
            <span className={`dot ${ghOk ? "ok" : "bad"}`} />
            {!health.ghAvailable
              ? "gh missing"
              : health.loggedIn
                ? health.login
                  ? `@${health.login}`
                  : "gh"
                : "not logged in"}
          </span>
        )}
      </header>
      <main>
        {health && !health.ghAvailable && (
          <div className="banner warn">
            <code>gh</code> was not found on PATH. Install the GitHub CLI and restart batbelt.
          </div>
        )}
        {health?.ghAvailable && !health.loggedIn && (
          <div className="banner warn">
            GitHub CLI is not logged in. Run <code>gh auth login</code>.
          </div>
        )}
        {error && <div className="banner bad">{error}</div>}
        {ready && config ? (
          <Routes>
            <Route path="/" element={<Navigate to="inbox" replace />} />
            <Route
              path="inbox"
              element={<InboxPage inbox={inbox} config={config} onRefresh={refresh} />}
            />
          </Routes>
        ) : (
          <p className="muted">{ready ? "No PR Looker config loaded." : "Loading…"}</p>
        )}
      </main>
    </div>
  );
}

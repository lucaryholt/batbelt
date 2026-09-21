import { useCallback, useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import type { AppConfig, EnvStatus, HealthResponse } from "./types";
import { getConfig, getHealth, getStatus, openConfig } from "./api";
import { SecretsPage } from "./pages/Secrets";
import { SettingsPage } from "./pages/Settings";
import { useToast } from "../../shell/toast";
import "./steamer.css";

export function SteamerApp() {
  const [config, setConfig] = useState<AppConfig>({ environments: [] });
  const [status, setStatus] = useState<EnvStatus[]>([]);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [ready, setReady] = useState(false);
  const { flash } = useToast();

  const refresh = useCallback(async () => {
    const [nextConfig, nextStatus, nextHealth] = await Promise.all([
      getConfig(),
      getStatus(),
      getHealth(),
    ]);
    setConfig(nextConfig);
    setStatus(nextStatus.environments);
    setHealth(nextHealth);
  }, []);

  useEffect(() => {
    void refresh()
      .catch((err: Error) => {
        console.error(err);
      })
      .finally(() => setReady(true));
  }, [refresh]);

  return (
    <div className="steamer-app">
      <header>
        <span className="logo">steamer</span>
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
        {health && !health.baoAvailable && <span className="muted">bao CLI not found on PATH</span>}
        <div className="st-env-pills">
          {status.map((env) => (
            <span className="st-pill" key={env.name} title={env.addr}>
              <span className={`dot ${env.loggedIn ? "ok" : "bad"}`} />
              {env.name}
            </span>
          ))}
        </div>
      </header>
      <main>
        {health && !health.baoAvailable && (
          <div className="banner warn">
            The <code>bao</code> CLI was not found on PATH. Install OpenBao and restart batbelt.
          </div>
        )}
        {ready ? (
          <Routes>
            <Route path="/" element={<Navigate to="secrets" replace />} />
            <Route
              path="secrets"
              element={<SecretsPage config={config} status={status} onRefresh={refresh} />}
            />
            <Route
              path="settings"
              element={<SettingsPage config={config} status={status} health={health} onChange={refresh} />}
            />
          </Routes>
        ) : (
          <p className="muted">Loading…</p>
        )}
      </main>
    </div>
  );
}

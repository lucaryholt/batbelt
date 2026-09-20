import { useCallback, useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { getConfig, getHealth } from "./api";
import { ServicesPage } from "./pages/Services";
import type { ConfigResponse, HealthResponse } from "./types";
import "./kickflip.css";

export function KickflipApp() {
  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    const [nextConfig, nextHealth] = await Promise.all([getConfig(), getHealth()]);
    setConfig(nextConfig);
    setHealth(nextHealth);
    setError(null);
  }, []);

  useEffect(() => {
    void refresh()
      .catch((err: Error) => setError(err.message))
      .finally(() => setReady(true));
  }, [refresh]);

  return (
    <div className="kickflip-app">
      <header>
        <span className="logo">kickflip</span>
        {health && (
          <span className="st-pill">
            <span className={`dot ${health.kubectlAvailable ? "ok" : "bad"}`} />
            {health.kubectlAvailable ? health.kubectlVersion || "kubectl" : "kubectl missing"}
          </span>
        )}
      </header>
      <main>
        {health && !health.kubectlAvailable && (
          <div className="banner warn">
            <code>kubectl</code> was not found on PATH. Install it and restart batbelt.
          </div>
        )}
        {error && <div className="banner bad">{error}</div>}
        {ready && config ? (
          <Routes>
            <Route path="/" element={<Navigate to="services" replace />} />
            <Route path="services" element={<ServicesPage config={config} onReload={refresh} />} />
          </Routes>
        ) : (
          <p className="muted">{ready ? "No Kickflip config loaded." : "Loading…"}</p>
        )}
      </main>
    </div>
  );
}

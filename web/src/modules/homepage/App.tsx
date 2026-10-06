import { useCallback, useEffect, useRef, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { getConfig, openConfig } from "./api";
import { LinksPage, type LinksPageHandle } from "./pages/Links";
import { emptyConfig, type HomepageConfig } from "./types";
import { useToast } from "../../shell/toast";
import "./homepage.css";

export function HomepageApp() {
  const [config, setConfig] = useState<HomepageConfig>(emptyConfig());
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const { flash } = useToast();
  const linksRef = useRef<LinksPageHandle>(null);

  const refresh = useCallback(async () => {
    const next = await getConfig();
    setConfig(next);
    setError(null);
  }, []);

  useEffect(() => {
    void refresh()
      .catch((err: Error) => setError(err.message))
      .finally(() => setReady(true));
  }, [refresh]);

  return (
    <div className="homepage-app">
      <header>
        <span className="logo">homepage</span>
        <div className="header-actions">
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
            disabled={!ready}
            onClick={() => linksRef.current?.addSection()}
          >
            Add section
          </button>
        </div>
      </header>
      <main>
        {error && <div className="banner bad">{error}</div>}
        {ready ? (
          <Routes>
            <Route path="/" element={<Navigate to="links" replace />} />
            <Route path="links" element={<LinksPage ref={linksRef} config={config} onChange={setConfig} />} />
          </Routes>
        ) : (
          <p className="muted">Loading…</p>
        )}
      </main>
    </div>
  );
}

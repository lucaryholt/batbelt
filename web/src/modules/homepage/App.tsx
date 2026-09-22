import { useCallback, useEffect, useRef, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { getConfig, openConfig, saveConfig } from "./api";
import { LinksPage, type LinksPageHandle } from "./pages/Links";
import { emptyConfig, type HomepageConfig, type TerminalKind } from "./types";
import { useToast } from "../../shell/toast";
import "./homepage.css";

const PRESETS: { kind: Exclude<TerminalKind, "custom">; label: string }[] = [
  { kind: "terminal-app", label: "Terminal.app" },
  { kind: "kitty-tab", label: "Kitty tab" },
];

export function HomepageApp() {
  const [config, setConfig] = useState<HomepageConfig>(emptyConfig());
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [termOpen, setTermOpen] = useState(false);
  const [listenOn, setListenOn] = useState("");
  const { flash } = useToast();
  const linksRef = useRef<LinksPageHandle>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    const next = await getConfig();
    setConfig(next);
    setListenOn(next.terminal?.kind === "kitty-tab" ? next.terminal.listenOn ?? "" : "");
    setError(null);
  }, []);

  useEffect(() => {
    void refresh()
      .catch((err: Error) => setError(err.message))
      .finally(() => setReady(true));
  }, [refresh]);

  useEffect(() => {
    if (!termOpen) return;
    function onDocClick(event: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        setTermOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [termOpen]);

  const terminal = config.terminal ?? { kind: "terminal-app" as const };
  const custom = terminal.kind === "custom";

  async function persistTerminal(kind: Exclude<TerminalKind, "custom">) {
    if (custom) return;
    const next: HomepageConfig = {
      ...config,
      terminal:
        kind === "kitty-tab"
          ? { kind: "kitty-tab", listenOn: listenOn.trim() || undefined }
          : { kind },
    };
    try {
      const saved = await saveConfig(next);
      setConfig(saved);
      setListenOn(saved.terminal?.kind === "kitty-tab" ? saved.terminal.listenOn ?? "" : listenOn);
      flash(`Pi terminal: ${PRESETS.find((item) => item.kind === kind)?.label ?? kind}`);
    } catch (err) {
      flash((err as Error).message, true);
    }
  }

  async function persistListenOn() {
    if (terminal.kind !== "kitty-tab") return;
    try {
      const saved = await saveConfig({
        ...config,
        terminal: { kind: "kitty-tab", listenOn: listenOn.trim() || undefined },
      });
      setConfig(saved);
    } catch (err) {
      flash((err as Error).message, true);
    }
  }

  return (
    <div className="homepage-app">
      <header>
        <span className="logo">homepage</span>
        <div className="header-actions">
          <div className="terminal-popover" ref={popoverRef}>
            <button
              className="btn small"
              disabled={!ready}
              onClick={() => setTermOpen((open) => !open)}
            >
              Pi terminal
            </button>
            {termOpen && (
              <div className="terminal-panel">
                <h3>Open <code>pi</code> in</h3>
                {custom ? (
                  <p>Custom (edit YAML). Preset buttons are disabled so the argv is not overwritten.</p>
                ) : (
                  <div className="terminal-choices">
                    {PRESETS.map((item) => (
                      <button
                        key={item.kind}
                        type="button"
                        className={`btn small${terminal.kind === item.kind ? " primary" : ""}`}
                        onClick={() => void persistTerminal(item.kind)}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                )}
                {terminal.kind === "kitty-tab" && !custom && (
                  <label className="field" style={{ marginTop: 10 }}>
                    listenOn
                    <input
                      className="mono"
                      value={listenOn}
                      onChange={(e) => setListenOn(e.target.value)}
                      onBlur={() => void persistListenOn()}
                      placeholder="unix:/tmp/mykitty"
                    />
                  </label>
                )}
                <p>
                  Kitty tabs need <code>allow_remote_control</code> and <code>listen_on</code> in{" "}
                  <code>kitty.conf</code>. Terminal.app opens a new window.
                </p>
              </div>
            )}
          </div>
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

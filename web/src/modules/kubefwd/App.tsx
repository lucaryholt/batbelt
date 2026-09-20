import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import type { AppState, PortInfo } from "./types";
import { api } from "./api";
import { collectTags } from "./tagColor";
import { TagChip } from "./components/TagChip";
import { ServicesTab } from "./tabs/ServicesTab";
import { ProxyTab } from "./tabs/ProxyTab";
import { PortsTab } from "./tabs/PortsTab";
import { ExploreTab } from "./tabs/ExploreTab";
import { useToast } from "../../shell/toast";

export function KubefwdApp() {
  const [state, setState] = useState<AppState | null>(null);
  const [connected, setConnected] = useState(false);
  const [ports, setPorts] = useState<PortInfo[] | null>(null);
  const [debugOpen, setDebugOpen] = useState(true);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const { flash } = useToast();
  const location = useLocation();
  const page = location.pathname.split("/").filter(Boolean)[1] ?? "services";

  const run = useCallback(
    async (fn: () => Promise<unknown>, ok?: string) => {
      try {
        await fn();
        if (ok) flash(ok);
      } catch (err) {
        flash(err instanceof Error ? err.message : String(err), true);
      }
    },
    [flash],
  );

  useEffect(() => {
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout>;
    const connect = () => {
      es = new EventSource("/api/kubefwd/state");
      es.onopen = () => setConnected(true);
      es.onmessage = (ev) => {
        try {
          setState(JSON.parse(ev.data) as AppState);
        } catch {
          /* ignore */
        }
      };
      es.onerror = () => {
        setConnected(false);
        es?.close();
        retry = setTimeout(connect, 3000);
      };
    };
    connect();
    return () => {
      es?.close();
      clearTimeout(retry);
    };
  }, []);

  const refreshPorts = useCallback(async () => {
    try {
      setPorts(await api.getPorts());
    } catch (err) {
      flash(err instanceof Error ? err.message : String(err), true);
    }
  }, [flash]);

  useEffect(() => {
    if (page === "ports") void refreshPorts();
  }, [page, refreshPorts]);

  const allTags = useMemo(() => (state ? collectTags(state) : []), [state]);

  useEffect(() => {
    setSelectedTags((prev) => prev.filter((t) => allTags.includes(t)));
  }, [allTags]);

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  };

  if (!state) {
    return (
      <div id="app">
        <header>
          <span className="logo">kubefwd</span>
          <span className="muted">Connecting…</span>
        </header>
      </div>
    );
  }

  const showFilter = (page === "services" || page === "proxy") && allTags.length > 0;

  return (
    <div id="app">
      <header>
        <span className="logo">kubefwd</span>
        <span className="cluster-badge">{state.cluster_name || state.cluster_context || "no context"}</span>
        <span className="ns-badge">{state.namespace}</span>
        <span className={`conn-dot${connected ? "" : " off"}`} title={connected ? "connected" : "disconnected"} />
      </header>
      {showFilter && (
        <div className="tag-filter" role="toolbar" aria-label="Filter by tags">
          <span className="tag-filter-label">Tags</span>
          {allTags.map((tag) => (
            <TagChip key={tag} tag={tag} selected={selectedTags.includes(tag)} onClick={() => toggleTag(tag)} />
          ))}
          {selectedTags.length > 0 && (
            <button className="icon" onClick={() => setSelectedTags([])}>
              Clear
            </button>
          )}
        </div>
      )}
      <main>
        <Routes>
          <Route path="/" element={<Navigate to="services" replace />} />
          <Route path="services" element={<ServicesTab state={state} run={run} selectedTags={selectedTags} />} />
          <Route path="proxy" element={<ProxyTab state={state} run={run} selectedTags={selectedTags} />} />
          <Route path="ports" element={<PortsTab ports={ports} refresh={refreshPorts} run={run} />} />
          <Route
            path="explore"
            element={
              state.capabilities.explore ? (
                <ExploreTab state={state} run={run} flash={flash} selectedTags={selectedTags} />
              ) : (
                <p className="empty">Explore needs a writable SQLite store.</p>
              )
            }
          />
        </Routes>
      </main>
      {state.debug_mode && (
        <div className={`debug-drawer${debugOpen ? "" : " minimized"}`}>
          <header>
            <span>debug — /tmp/kubefwd-debug.log</span>
            <button
              className="icon"
              title={debugOpen ? "Minimize" : "Expand"}
              onClick={() => setDebugOpen((v) => !v)}
            >
              {debugOpen ? "▾" : "▴"}
            </button>
          </header>
          {debugOpen && <div className="debug-body">{state.debug_lines.join("\n")}</div>}
        </div>
      )}
    </div>
  );
}

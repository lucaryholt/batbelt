import { useState } from "react";
import type { AppState, ProxyServiceConfig, ProxyServiceState } from "../types";
import { api } from "../api";
import { ProxyForm } from "../components/Forms";
import { TagList } from "../components/TagChip";
import { matchesTagFilter } from "../tagColor";

export function ProxyTab({
  state,
  run,
  selectedTags,
}: {
  state: AppState;
  run: (fn: () => Promise<unknown>, ok?: string) => Promise<void>;
  selectedTags: string[];
}) {
  const writable = state.capabilities.writable;
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<ProxyServiceConfig | null>(null);
  const [info, setInfo] = useState<Set<string>>(new Set());

  const groups = state.proxy_groups
    .map((g) => ({
      ...g,
      services: g.services.filter((p) => matchesTagFilter(p.tags, selectedTags)),
    }))
    .filter((g) => g.services.length > 0 || selectedTags.length === 0);
  const visibleCount = groups.reduce((n, g) => n + g.services.length, 0);
  const totalCount = state.proxy_groups.reduce((n, g) => n + g.services.length, 0);

  const toggleInfo = (id: string) => {
    setInfo((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <>
      <div className="toolbar">
        {writable && <button onClick={() => setAdding(true)}>＋ Add proxy service</button>}
        <button className="success" onClick={() => void run(() => api.startDefaultProxies())}>
          ▶ Start Defaults
        </button>
        <button
          className="amber"
          onClick={() => {
            if (
              confirm(
                "All active proxy forwards and their sql-tap instances will be stopped, all pods deleted, then recreated with the same selection.",
              )
            ) {
              void run(() => api.resetProxy(), "Resetting pods");
            }
          }}
        >
          ↺ Reset All Pods
        </button>
      </div>
      {state.proxy_groups.length === 0 && (
        <div className="empty">
          No proxy services yet. Proxy pods relay traffic to GCP resources (Cloud SQL, Memorystore) that have no
          Kubernetes Service.
          {writable ? " Use ＋ Add or the Explore tab to add one." : " Add entries to your YAML config and reload."}
        </div>
      )}
      {state.proxy_groups.length > 0 && totalCount > 0 && visibleCount === 0 && (
        <div className="empty">No proxy services match the selected tags.</div>
      )}
      {groups.map((g) => (
        <div key={g.group_key} className="proxy-group">
          <div className="proxy-group-header">
            <div className="proxy-group-label">
              <span className="proxy-group-context">{g.context}</span>
              <span className="proxy-group-ns">{g.namespace}</span>
            </div>
            <div className="proxy-group-pod-status">
              <span
                className={`status-dot ${g.pod_status === "ready" ? "running" : g.pod_status === "creating" ? "starting" : g.pod_status === "error" ? "error" : ""}`}
              />
              {g.pod_status}
              {g.pod_error ? ` — ${g.pod_error}` : ""}
            </div>
            <div className="proxy-group-actions">
              <button className="icon success" onClick={() => void run(() => api.startProxyPod(g.group_key))}>
                ▶ Start Pod
              </button>
              <button className="icon danger" onClick={() => void run(() => api.killPod(g.group_key), "Pod killed")}>
                ✕ Kill Pod
              </button>
            </div>
          </div>
          <div className="proxy-group-body">
            {g.services.map((p) => (
              <ProxyRow
                key={p.id}
                p={p}
                writable={writable}
                expanded={info.has(p.id)}
                onInfo={() => toggleInfo(p.id)}
                run={run}
                onEdit={setEditing}
              />
            ))}
          </div>
        </div>
      ))}
      {adding && (
        <ProxyForm
          title="Add proxy service"
          initial={{
            proxy_pod_context: state.cluster_context,
            proxy_pod_namespace: state.namespace,
            tags: selectedTags,
          }}
          onClose={() => setAdding(false)}
          onSave={(ps) => {
            void run(() => api.addProxyService(ps), "Proxy service added");
            setAdding(false);
          }}
        />
      )}
      {editing && (
        <ProxyForm
          title="Edit proxy service"
          initial={editing}
          onClose={() => setEditing(null)}
          onSave={(ps) => {
            void run(() => api.updateProxyService(editing.id ?? ps.id ?? "", { ...ps, id: editing.id }), "Updated");
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

function ProxyRow({
  p,
  writable,
  expanded,
  onInfo,
  run,
  onEdit,
}: {
  p: ProxyServiceState;
  writable: boolean;
  expanded: boolean;
  onInfo: () => void;
  run: (fn: () => Promise<unknown>, ok?: string) => Promise<void>;
  onEdit: (ps: ProxyServiceConfig) => void;
}) {
  const running = p.status === "running" || p.status === "starting";
  return (
    <>
      <div className={`service-row ${p.status}`}>
        <span className={`status-dot ${p.status}`} />
        <div className="svc-info">
          <div className="svc-name">
            <span className="svc-name-text">{p.name}</span>
            <TagList tags={p.tags ?? []} />
            {p.is_default && <span className="badge-default">default</span>}
            {p.has_sql_tap && <span className="badge-sqltap">sql-tap :{p.sql_tap_port}</span>}
            {p.retrying && (
              <span className="badge-sqltap">
                ↻ {p.retry_attempt}/{p.max_retries === -1 ? "∞" : p.max_retries}
              </span>
            )}
          </div>
          <div className="svc-meta">
            <span className="port-tag local">:{p.local_port}</span>
          </div>
          {p.error && <div className="svc-error">{p.error}</div>}
        </div>
        <div className="svc-actions">
          {p.has_sql_tap && (
            <button className="icon amber" onClick={onInfo} title="SQL-tap info">
              ℹ sql-tap
            </button>
          )}
          {p.has_sql_tap && p.sql_tap_http_port && p.status === "running" && (
            <a className="icon" href={`http://localhost:${p.sql_tap_http_port}`} target="_blank" rel="noopener">
              ↗ web
            </a>
          )}
          {running ? (
            <button className="icon danger" onClick={() => void run(() => api.stopProxyService(p.id))}>
              ■ Stop
            </button>
          ) : (
            <button className="icon success" onClick={() => void run(() => api.startProxyService(p.id))}>
              ▶ Start
            </button>
          )}
          {writable && (
            <>
              <button
                className="icon"
                onClick={() =>
                  void api.getProxyService(p.id).then(onEdit).catch((err) =>
                    run(async () => {
                      throw err;
                    }),
                  )
                }
              >
                ✎
              </button>
              <button
                className="icon danger"
                onClick={() => {
                  if (confirm(`Remove proxy service “${p.name}”?`))
                    void run(() => api.deleteProxyService(p.id), "Removed");
                }}
              >
                ✕
              </button>
            </>
          )}
        </div>
      </div>
      {expanded && p.has_sql_tap && (
        <div className="sqltap-info">
          <div className="sqltap-info-row">
            <span className="sqltap-info-key">Listen</span>
            <span className="sqltap-info-val">:{p.sql_tap_port}</span>
          </div>
          <div className="sqltap-info-row">
            <span className="sqltap-info-key">gRPC</span>
            <span className="sqltap-info-val">:{p.sql_tap_grpc_port}</span>
          </div>
          {p.sql_tap_http_port ? (
            <div className="sqltap-info-row">
              <span className="sqltap-info-key">Web port</span>
              <span className="sqltap-info-val">:{p.sql_tap_http_port}</span>
            </div>
          ) : null}
          <div className="sqltap-cmd">sql-tap localhost:{p.sql_tap_grpc_port}</div>
          {p.sql_tap_http_port ? (
            <a
              className="sqltap-cmd"
              href={`http://localhost:${p.sql_tap_http_port}`}
              target="_blank"
              rel="noopener"
              style={{ display: "block", marginTop: 4, textDecoration: "none" }}
            >
              ↗ Open web interface
            </a>
          ) : null}
        </div>
      )}
    </>
  );
}

import { useState } from "react";
import type { AppState, ServiceConfig, ServiceState } from "../types";
import { api } from "../api";
import { ServiceForm } from "../components/Forms";
import { TagList } from "../components/TagChip";
import { matchesTagFilter } from "../tagColor";

export function ServicesTab({
  state,
  run,
  selectedTags,
}: {
  state: AppState;
  run: (fn: () => Promise<unknown>, ok?: string) => Promise<void>;
  selectedTags: string[];
}) {
  const writable = state.capabilities.writable;
  const visible = state.services.filter((s) => matchesTagFilter(s.tags, selectedTags));
  const running = visible.filter((s) => s.status === "running").length;
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<ServiceConfig | null>(null);
  const [info, setInfo] = useState<Set<string>>(new Set());

  const toggle = (s: ServiceState) => {
    if (s.status === "running" || s.status === "starting") void run(() => api.stopService(s.id));
    else void run(() => api.startService(s.id));
  };

  return (
    <>
      <div className="toolbar">
        <button className="success" onClick={() => void run(() => api.startDefaults())}>
          ▶ Start Defaults
        </button>
        <button className="primary" onClick={() => void run(() => api.startAll())}>
          Start All
        </button>
        <button className="danger" onClick={() => void run(() => api.stopAll())}>
          Stop All
        </button>
        {writable && <button onClick={() => setAdding(true)}>＋ Add service</button>}
        <div className="toolbar-right muted">
          {running}/{visible.length} running
        </div>
      </div>
      <div className="service-list">
        {visible.map((s) => (
          <ServiceRow
            key={s.id}
            s={s}
            writable={writable}
            expanded={info.has(s.id)}
            onToggle={() => toggle(s)}
            onInfo={() =>
              setInfo((prev) => {
                const next = new Set(prev);
                if (next.has(s.id)) next.delete(s.id);
                else next.add(s.id);
                return next;
              })
            }
            run={run}
            onEdit={setEditing}
          />
        ))}
        {state.services.length === 0 && <div className="empty">No services configured.</div>}
        {state.services.length > 0 && visible.length === 0 && (
          <div className="empty">No services match the selected tags.</div>
        )}
      </div>
      {adding && (
        <ServiceForm
          title="Add service"
          initial={{ tags: selectedTags }}
          onClose={() => setAdding(false)}
          onSave={(sv) => {
            void run(() => api.addService(sv), "Service added");
            setAdding(false);
          }}
        />
      )}
      {editing && (
        <ServiceForm
          title="Edit service"
          initial={editing}
          onClose={() => setEditing(null)}
          onSave={(sv) => {
            void run(() => api.updateService(editing.id ?? sv.id ?? "", { ...sv, id: editing.id }), "Service updated");
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

function ServiceRow({
  s,
  writable,
  expanded,
  onToggle,
  onInfo,
  run,
  onEdit,
}: {
  s: ServiceState;
  writable: boolean;
  expanded: boolean;
  onToggle: () => void;
  onInfo: () => void;
  run: (fn: () => Promise<unknown>, ok?: string) => Promise<void>;
  onEdit: (sv: ServiceConfig) => void;
}) {
  const retryLabel =
    s.retrying &&
    (s.max_retries === -1 ? `↻ ${s.retry_attempt}/∞` : `↻ ${s.retry_attempt}/${s.max_retries}`);
  return (
    <>
      <div className={`service-row ${s.status}`} onClick={onToggle}>
        <span className={`status-dot ${s.status}`} />
        <div className="svc-info">
          <div className="svc-name">
            <span className="svc-name-text">{s.name}</span>
            <TagList tags={s.tags ?? []} />
            {s.is_default && <span className="badge-default">default</span>}
            {s.has_sql_tap && <span className="badge-sqltap">sql-tap :{s.sql_tap_port}</span>}
            {retryLabel && <span className="badge-sqltap">{retryLabel}</span>}
          </div>
          <div className="svc-meta">
            <span className="port-tag local">:{s.local_port}</span>
            <span className="port-tag">→ {s.remote_port}</span>
          </div>
          {s.error && <div className="svc-error">{s.error}</div>}
        </div>
        <div className="svc-actions" onClick={(e) => e.stopPropagation()}>
          {s.has_sql_tap && (
            <button className="icon amber" onClick={onInfo} title="SQL-tap info">
              ℹ sql-tap
            </button>
          )}
          {s.has_sql_tap && s.sql_tap_http_port && s.status === "running" && (
            <a className="icon" href={`http://localhost:${s.sql_tap_http_port}`} target="_blank" rel="noopener">
              ↗ web
            </a>
          )}
          {s.status === "running" || s.status === "starting" ? (
            <button className="icon danger" onClick={onToggle}>
              Stop
            </button>
          ) : (
            <button className="icon success" onClick={onToggle}>
              Start
            </button>
          )}
          {writable && (
            <>
              <button
                className="icon"
                onClick={() =>
                  void api.getService(s.id).then(onEdit).catch((err) =>
                    run(async () => {
                      throw err;
                    }),
                  )
                }
              >
                Edit
              </button>
              <button
                className="icon danger"
                onClick={() => {
                  if (confirm(`Remove service “${s.name}”?`)) void run(() => api.deleteService(s.id), "Removed");
                }}
              >
                ✕
              </button>
            </>
          )}
        </div>
      </div>
      {expanded && s.has_sql_tap && (
        <div className="sqltap-info">
          <div className="sqltap-info-row">
            <span className="sqltap-info-key">Listen</span>
            <span className="sqltap-info-val">:{s.sql_tap_port}</span>
          </div>
          <div className="sqltap-info-row">
            <span className="sqltap-info-key">gRPC</span>
            <span className="sqltap-info-val">:{s.sql_tap_grpc_port}</span>
          </div>
          {s.sql_tap_http_port ? (
            <div className="sqltap-info-row">
              <span className="sqltap-info-key">Web port</span>
              <span className="sqltap-info-val">:{s.sql_tap_http_port}</span>
            </div>
          ) : null}
          <div className="sqltap-cmd">sql-tap localhost:{s.sql_tap_grpc_port}</div>
        </div>
      )}
    </>
  );
}

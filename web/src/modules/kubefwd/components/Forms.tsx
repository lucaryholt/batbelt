import { useState } from "react";
import type { KeyboardEvent } from "react";
import type { ProxyServiceConfig, ServiceConfig } from "../types";
import { TagChip } from "./TagChip";

type SqlTapConfig = Pick<
  ServiceConfig,
  "sql_tap_port" | "sql_tap_driver" | "sql_tap_grpc_port" | "sql_tap_http_port"
>;

function parseOptionalPort(raw: string): number | undefined {
  const t = raw.trim();
  if (!t) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

function omitEmptySqlTap<T extends SqlTapConfig>(form: T): T {
  const { sql_tap_port, sql_tap_driver, sql_tap_grpc_port, sql_tap_http_port, ...rest } = form;
  if (sql_tap_port === undefined) return rest as T;
  const out = { ...rest, sql_tap_port } as T;
  if (sql_tap_driver) out.sql_tap_driver = sql_tap_driver;
  if (sql_tap_grpc_port !== undefined) out.sql_tap_grpc_port = sql_tap_grpc_port;
  if (sql_tap_http_port !== undefined) out.sql_tap_http_port = sql_tap_http_port;
  return out;
}

function SqlTapFields({
  value,
  onChange,
}: {
  value: SqlTapConfig;
  onChange: (patch: Partial<SqlTapConfig>) => void;
}) {
  return (
    <>
      <div className="form-section-label full">SQL tap</div>
      <label>
        sql-tap port
        <input
          type="number"
          placeholder="off"
          value={value.sql_tap_port ?? ""}
          onChange={(e) => onChange({ sql_tap_port: parseOptionalPort(e.target.value) })}
        />
      </label>
      <label>
        Driver
        <select
          value={value.sql_tap_driver ?? ""}
          onChange={(e) => onChange({ sql_tap_driver: e.target.value || undefined })}
        >
          <option value="">—</option>
          <option value="postgres">postgres</option>
          <option value="mysql">mysql</option>
        </select>
      </label>
      <label>
        gRPC port
        <input
          type="number"
          placeholder="auto"
          value={value.sql_tap_grpc_port ?? ""}
          onChange={(e) => onChange({ sql_tap_grpc_port: parseOptionalPort(e.target.value) })}
        />
      </label>
      <label>
        HTTP UI port
        <input
          type="number"
          placeholder="optional"
          value={value.sql_tap_http_port ?? ""}
          onChange={(e) => onChange({ sql_tap_http_port: parseOptionalPort(e.target.value) })}
        />
      </label>
    </>
  );
}

function TagInput({
  tags,
  onChange,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  const commit = (raw: string) => {
    const parts = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!parts.length) return;
    const next = [...tags];
    for (const p of parts) {
      if (!next.includes(p)) next.push(p);
    }
    onChange(next);
    setDraft("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commit(draft);
    } else if (e.key === "Backspace" && !draft && tags.length) {
      onChange(tags.slice(0, -1));
    }
  };

  return (
    <label className="full">
      Tags
      <div className="tag-input">
        {tags.map((t) => (
          <TagChip key={t} tag={t} removable onClick={() => onChange(tags.filter((x) => x !== t))} />
        ))}
        <input
          value={draft}
          placeholder={tags.length ? "Add another…" : "Add tag, then Enter or comma"}
          onChange={(e) => {
            const v = e.target.value;
            if (v.includes(",")) commit(v);
            else setDraft(v);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => {
            if (draft.trim()) commit(draft);
          }}
        />
      </div>
    </label>
  );
}

export function ServiceForm(props: {
  title: string;
  initial?: Partial<ServiceConfig>;
  onClose: () => void;
  onSave: (sv: ServiceConfig) => void;
}) {
  const [form, setForm] = useState<ServiceConfig>({
    name: "",
    service_name: "",
    remote_port: 80,
    local_port: 80,
    selected_by_default: false,
    ...props.initial,
    tags: props.initial?.tags ?? [],
  });
  const set = (k: keyof ServiceConfig, v: string | number | boolean | undefined) =>
    setForm((f) => ({ ...f, [k]: v }));
  return (
    <div className="modal-backdrop" onClick={props.onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{props.title}</h2>
        <div className="form-grid">
          <label>
            Name
            <input value={form.name} onChange={(e) => set("name", e.target.value)} />
          </label>
          <label>
            Kubernetes service
            <input value={form.service_name} onChange={(e) => set("service_name", e.target.value)} />
          </label>
          <label>
            Remote port
            <input type="number" value={form.remote_port} onChange={(e) => set("remote_port", Number(e.target.value))} />
          </label>
          <label>
            Local port
            <input type="number" value={form.local_port} onChange={(e) => set("local_port", Number(e.target.value))} />
          </label>
          <label>
            Context override
            <input value={form.context ?? ""} onChange={(e) => set("context", e.target.value || undefined)} />
          </label>
          <label>
            Namespace override
            <input value={form.namespace ?? ""} onChange={(e) => set("namespace", e.target.value || undefined)} />
          </label>
          <TagInput tags={form.tags ?? []} onChange={(tags) => setForm((f) => ({ ...f, tags }))} />
          <SqlTapFields value={form} onChange={(patch) => setForm((f) => ({ ...f, ...patch }))} />
          <label className="check full">
            <input
              type="checkbox"
              checked={form.selected_by_default}
              onChange={(e) => set("selected_by_default", e.target.checked)}
            />
            Start by default
          </label>
        </div>
        <div className="modal-actions">
          <button onClick={props.onClose}>Cancel</button>
          <button className="primary" onClick={() => props.onSave(omitEmptySqlTap(form))}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

export function ProxyForm(props: {
  title: string;
  initial?: Partial<ProxyServiceConfig>;
  onClose: () => void;
  onSave: (ps: ProxyServiceConfig) => void;
}) {
  const [form, setForm] = useState<ProxyServiceConfig>({
    name: "",
    target_host: "",
    target_port: 5432,
    local_port: 5432,
    selected_by_default: false,
    proxy_pod_context: "",
    proxy_pod_namespace: "default",
    ...props.initial,
    tags: props.initial?.tags ?? [],
  });
  const set = (k: keyof ProxyServiceConfig, v: string | number | boolean | undefined) =>
    setForm((f) => ({ ...f, [k]: v }));
  return (
    <div className="modal-backdrop" onClick={props.onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{props.title}</h2>
        <div className="form-grid">
          <label className="full">
            Name
            <input value={form.name} onChange={(e) => set("name", e.target.value)} />
          </label>
          <label>
            Target host
            <input value={form.target_host} onChange={(e) => set("target_host", e.target.value)} />
          </label>
          <label>
            Target port
            <input type="number" value={form.target_port} onChange={(e) => set("target_port", Number(e.target.value))} />
          </label>
          <label>
            Local port
            <input type="number" value={form.local_port} onChange={(e) => set("local_port", Number(e.target.value))} />
          </label>
          <label>
            Proxy pod context
            <input value={form.proxy_pod_context} onChange={(e) => set("proxy_pod_context", e.target.value)} />
          </label>
          <label>
            Proxy pod namespace
            <input value={form.proxy_pod_namespace} onChange={(e) => set("proxy_pod_namespace", e.target.value)} />
          </label>
          <TagInput tags={form.tags ?? []} onChange={(tags) => setForm((f) => ({ ...f, tags }))} />
          <SqlTapFields value={form} onChange={(patch) => setForm((f) => ({ ...f, ...patch }))} />
          <label className="check full">
            <input
              type="checkbox"
              checked={form.selected_by_default}
              onChange={(e) => set("selected_by_default", e.target.checked)}
            />
            Start by default
          </label>
        </div>
        <div className="modal-actions">
          <button onClick={props.onClose}>Cancel</button>
          <button className="primary" onClick={() => props.onSave(omitEmptySqlTap(form))}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

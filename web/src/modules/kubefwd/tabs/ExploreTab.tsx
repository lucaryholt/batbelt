import { useEffect, useState } from "react";
import type {
  AppState,
  CloudSQLInstance,
  GCPDiscoveryResult,
  GCPProject,
  K8sServiceInfo,
  MemorystoreInstance,
} from "../types";
import { api } from "../api";
import { sameTagSet } from "../tagColor";

export function ExploreTab({
  state,
  run,
  flash,
  selectedTags,
}: {
  state: AppState;
  run: (fn: () => Promise<unknown>, ok?: string) => Promise<void>;
  flash: (msg: string, error?: boolean) => void;
  selectedTags: string[];
}) {
  return (
    <>
      <K8sSection state={state} run={run} flash={flash} selectedTags={selectedTags} />
      <GcpSection state={state} run={run} flash={flash} selectedTags={selectedTags} />
    </>
  );
}

function K8sSection({
  state,
  run,
  flash,
  selectedTags,
}: {
  state: AppState;
  run: (fn: () => Promise<unknown>, ok?: string) => Promise<void>;
  flash: (msg: string, error?: boolean) => void;
  selectedTags: string[];
}) {
  const [open, setOpen] = useState(false);
  const [contexts, setContexts] = useState<string[]>([]);
  const [namespaces, setNamespaces] = useState<string[]>([]);
  const [ctx, setCtx] = useState(state.cluster_context);
  const [ns, setNs] = useState(state.namespace);
  const [services, setServices] = useState<K8sServiceInfo[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    void api
      .explorerContexts()
      .then((list) => {
        setContexts(list);
        if (!list.includes(ctx) && list[0]) setCtx(list[0]);
      })
      .catch((err) => flash(err instanceof Error ? err.message : String(err), true));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open || !ctx) return;
    void api
      .explorerNamespaces(ctx)
      .then((list) => {
        setNamespaces(list);
        if (!list.includes(ns) && list[0]) setNs(list[0]);
      })
      .catch((err) => flash(err instanceof Error ? err.message : String(err), true));
  }, [open, ctx]); // eslint-disable-line react-hooks/exhaustive-deps

  const scan = async () => {
    setLoading(true);
    try {
      setServices(await api.explorerServices(ctx, ns));
    } catch (err) {
      flash(err instanceof Error ? err.message : String(err), true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open && ctx && ns) void scan();
  }, [open, ctx, ns]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="explore-section">
      <div className="explore-head" onClick={() => setOpen((v) => !v)}>
        <h3>Kubernetes Services</h3>
        <span className="muted">{open ? "▾" : "▸"}</span>
      </div>
      {open && (
        <div className="explore-body">
          <div className="toolbar">
            <label>
              Context
              <select value={ctx} onChange={(e) => setCtx(e.target.value)}>
                {contexts.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Namespace
              <select value={ns} onChange={(e) => setNs(e.target.value)}>
                {namespaces.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <button onClick={() => void scan()}>Scan</button>
          </div>
          {loading && <div className="muted">Loading…</div>}
          {services &&
            services.map((svc) => {
              const alreadyAdded = state.services.some(
                (s) => s.name === svc.name && sameTagSet(s.tags, selectedTags),
              );
              return (
                <div key={svc.name} className="explore-row">
                  <div className="svc-info">
                    <div className="svc-name">
                      {svc.name}
                      {alreadyAdded && <span className="badge-default">added</span>}
                    </div>
                    <div className="svc-meta">
                      <span className="port-tag">{svc.type}</span>
                      {svc.ports.map((p) => (
                        <span key={p.port} className="port-tag">
                          {p.port}/{p.protocol}
                        </span>
                      ))}
                    </div>
                  </div>
                  {!alreadyAdded &&
                    svc.ports.map((p) => (
                      <button
                        key={p.port}
                        className="icon success"
                        onClick={() =>
                          void run(
                            () =>
                              api.addService({
                                name: svc.name,
                                tags: selectedTags,
                                service_name: svc.name,
                                remote_port: p.port,
                                local_port: p.port,
                                selected_by_default: false,
                                context: ctx !== state.cluster_context ? ctx : undefined,
                                namespace: ns !== state.namespace ? ns : undefined,
                              }),
                            `Added ${svc.name}:${p.port}`,
                          ).then(() => scan())
                        }
                      >
                        + Add :{p.port}
                      </button>
                    ))}
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}

function GcpSection({
  state,
  run,
  flash,
  selectedTags,
}: {
  state: AppState;
  run: (fn: () => Promise<unknown>, ok?: string) => Promise<void>;
  flash: (msg: string, error?: boolean) => void;
  selectedTags: string[];
}) {
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<GCPProject[]>([]);
  const [project, setProject] = useState("");
  const [podCtx, setPodCtx] = useState(state.cluster_context);
  const [podNs, setPodNs] = useState(state.namespace);
  const [contexts, setContexts] = useState<string[]>([]);
  const [result, setResult] = useState<GCPDiscoveryResult | null>(null);
  const [loading, setLoading] = useState(false);

  const proxyRows = state.proxy_groups.flatMap((g) => g.services);
  const alreadyNamed = (name: string) =>
    proxyRows.some((p) => p.name === name && sameTagSet(p.tags, selectedTags));

  useEffect(() => {
    if (!open) return;
    void api
      .explorerContexts()
      .then(setContexts)
      .catch(() => undefined);
    void api
      .explorerGcpProjects()
      .then(({ projects: list, active }) => {
        setProjects(list);
        setProject(active || list[0]?.project_id || "");
      })
      .catch((err) => {
        setResult({ available: false, error: err instanceof Error ? err.message : String(err) });
      });
  }, [open]);

  const scan = async () => {
    setLoading(true);
    try {
      setResult(await api.explorerGcp(project));
    } catch (err) {
      flash(err instanceof Error ? err.message : String(err), true);
    } finally {
      setLoading(false);
    }
  };

  const addSql = (inst: CloudSQLInstance) => {
    const host = inst.private_ip;
    if (!host) {
      flash("No private IP", true);
      return;
    }
    const port = inst.db_version?.toLowerCase().includes("mysql") ? 3306 : 5432;
    void run(
      () =>
        api.addProxyService({
          name: inst.name,
          tags: selectedTags,
          target_host: host,
          target_port: port,
          local_port: port,
          selected_by_default: false,
          proxy_pod_context: podCtx,
          proxy_pod_namespace: podNs,
        }),
      `Added ${inst.name}`,
    ).then(() => scan());
  };

  const addRedis = (inst: MemorystoreInstance) => {
    void run(
      () =>
        api.addProxyService({
          name: inst.name,
          tags: selectedTags,
          target_host: inst.host,
          target_port: inst.port || 6379,
          local_port: inst.port || 6379,
          selected_by_default: false,
          proxy_pod_context: podCtx,
          proxy_pod_namespace: podNs,
        }),
      `Added ${inst.name}`,
    ).then(() => scan());
  };

  return (
    <div className="explore-section">
      <div className="explore-head" onClick={() => setOpen((v) => !v)}>
        <h3>GCP Resources</h3>
        <span className="muted">{open ? "▾" : "▸"}</span>
      </div>
      {open && (
        <div className="explore-body">
          {result && result.available === false && (
            <div className="muted">{result.error || "gcloud CLI is not installed."}</div>
          )}
          {(!result || result.available !== false) && (
            <>
              <div className="toolbar">
                <label>
                  Project
                  <select value={project} onChange={(e) => setProject(e.target.value)}>
                    {projects.map((p) => (
                      <option key={p.project_id} value={p.project_id}>
                        {p.name} ({p.project_id})
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Proxy pod context
                  <select value={podCtx} onChange={(e) => setPodCtx(e.target.value)}>
                    {(contexts.length ? contexts : [state.cluster_context]).map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Namespace
                  <input value={podNs} onChange={(e) => setPodNs(e.target.value)} />
                </label>
                <button className="primary" onClick={() => void scan()}>
                  Scan
                </button>
              </div>
              {loading && <div className="muted">Scanning…</div>}
              {result?.error && <div className="svc-error">{result.error}</div>}
              {result?.cloudsql?.map((inst) => {
                const added = alreadyNamed(inst.name);
                return (
                  <div key={inst.name} className="explore-row">
                    <div className="svc-info">
                      <div className="svc-name">
                        {inst.name}
                        {added && <span className="badge-default">added</span>}
                      </div>
                      <div className="svc-meta">
                        <span className="port-tag">Cloud SQL</span>
                        <span className="port-tag">{inst.db_version}</span>
                        {inst.private_ip && <span className="port-tag">{inst.private_ip}</span>}
                      </div>
                    </div>
                    {!added && inst.private_ip && (
                      <button className="icon success" onClick={() => addSql(inst)}>
                        + Add
                      </button>
                    )}
                  </div>
                );
              })}
              {result?.memorystore?.map((inst) => {
                const added = alreadyNamed(inst.name);
                return (
                  <div key={inst.name} className="explore-row">
                    <div className="svc-info">
                      <div className="svc-name">
                        {inst.name}
                        {added && <span className="badge-default">added</span>}
                      </div>
                      <div className="svc-meta">
                        <span className="port-tag">Memorystore</span>
                        <span className="port-tag">
                          {inst.host}:{inst.port}
                        </span>
                      </div>
                    </div>
                    {!added && (
                      <button className="icon success" onClick={() => addRedis(inst)}>
                        + Add
                      </button>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
}

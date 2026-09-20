import { useEffect, useMemo, useState } from "react";
import { runKickflip } from "../api";
import type { ConfigResponse, RunMode, RunServiceRef } from "../types";

function keyOf(namespace: string, name: string): string {
  return `${namespace}/${name}`;
}

function parseKey(key: string): RunServiceRef {
  const slash = key.indexOf("/");
  return { namespace: key.slice(0, slash), name: key.slice(slash + 1) };
}

export function ServicesPage({
  config,
  onReload,
}: {
  config: ConfigResponse;
  onReload: () => Promise<void>;
}) {
  const allKeys = useMemo(
    () => config.namespaces.flatMap((ns) => ns.services.map((svc) => keyOf(ns.name, svc.name))),
    [config],
  );
  const [context, setContext] = useState(config.defaultContext);
  const [mode, setMode] = useState<RunMode>("secrets-restart");
  const [selected, setSelected] = useState<string[]>([]);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);

  const selectedRefs = selected.map(parseKey);
  const contextLabel = config.contexts.find((ctx) => ctx.context === context)?.name ?? context;

  useEffect(() => {
    setSelected((current) => current.filter((key) => allKeys.includes(key)));
  }, [allKeys]);

  useEffect(() => {
    setContext((current) =>
      config.contexts.some((ctx) => ctx.context === current) ? current : config.defaultContext,
    );
  }, [config]);

  function toggle(key: string) {
    setSelected((current) => (current.includes(key) ? current.filter((item) => item !== key) : [...current, key]));
  }

  function selectNamespace(namespace: string, on: boolean) {
    const keys = config.namespaces
      .find((ns) => ns.name === namespace)
      ?.services.map((svc) => keyOf(namespace, svc.name)) ?? [];
    setSelected((current) => {
      const rest = current.filter((key) => !keys.includes(key));
      return on ? [...rest, ...keys] : rest;
    });
  }

  async function confirmRun() {
    setBusy(true);
    setError(null);
    setMessage(null);
    setLogs([]);
    setConfirm(false);
    try {
      let failed = 0;
      await runKickflip(
        { context, mode, services: selectedRefs, confirm: true },
        (event) => {
          if (event.type === "log") {
            setLogs((current) => [...current, event.line]);
          } else if (event.type === "service" && !event.ok) {
            failed += 1;
            setLogs((current) => [...current, `${event.namespace}/${event.name}: ${event.error || "failed"}`]);
          } else if (event.type === "error") {
            setError(event.error);
          }
        },
      );
      if (failed) setError(`${failed} service${failed === 1 ? "" : "s"} failed.`);
      else setMessage(`Finished ${mode === "secrets-restart" ? "secrets + restart" : "restart"} for ${selectedRefs.length} service${selectedRefs.length === 1 ? "" : "s"}.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!config.namespaces.length) {
    return (
      <div className="card">
        <p>No services in the Kickflip YAML. Edit <code>~/.config/batbelt/kickflip/config.yaml</code> and reload.</p>
      </div>
    );
  }

  return (
    <div className="stack">
      {message && <div className="banner ok">{message}</div>}
      {error && <div className="banner bad">{error}</div>}

      <section className="card">
        <div className="row">
          <label className="field narrow">
            Context
            <select value={context} onChange={(e) => setContext(e.target.value)} disabled={busy}>
              {config.contexts.map((ctx) => (
                <option key={ctx.context} value={ctx.context}>
                  {ctx.name} ({ctx.context})
                </option>
              ))}
            </select>
          </label>
          <div className="field">
            Mode
            <div className="actions">
              <button
                className={`btn${mode === "restart" ? " primary" : ""}`}
                disabled={busy}
                onClick={() => setMode("restart")}
              >
                Restart
              </button>
              <button
                className={`btn${mode === "secrets-restart" ? " primary" : ""}`}
                disabled={busy}
                onClick={() => setMode("secrets-restart")}
              >
                Secrets + restart
              </button>
            </div>
          </div>
        </div>
        <div className="actions" style={{ marginTop: 16 }}>
          <button className="btn small" disabled={busy} onClick={() => setSelected(allKeys)}>
            Select all
          </button>
          <button className="btn small" disabled={busy} onClick={() => setSelected([])}>
            Unselect all
          </button>
          <button
            className="btn small"
            disabled={busy}
            onClick={() => {
              void onReload()
                .then(() => setMessage("Reloaded Kickflip config."))
                .catch((err: Error) => setError(err.message));
            }}
          >
            Reload config
          </button>
          <span className="muted">{selected.length} selected</span>
        </div>
      </section>

      {config.namespaces.map((ns) => {
        const keys = ns.services.map((svc) => keyOf(ns.name, svc.name));
        const checked = keys.filter((key) => selected.includes(key)).length;
        return (
          <section className="card" key={ns.name}>
            <div className="env-card-head">
              <strong>{ns.name}</strong>
              <div className="actions">
                <span className="muted">
                  {checked}/{keys.length}
                </span>
                <button className="btn small" disabled={busy} onClick={() => selectNamespace(ns.name, true)}>
                  Select all
                </button>
                <button className="btn small" disabled={busy} onClick={() => selectNamespace(ns.name, false)}>
                  Unselect
                </button>
              </div>
            </div>
            <div className="service-grid">
              {ns.services.map((svc) => {
                const key = keyOf(ns.name, svc.name);
                const on = selected.includes(key);
                return (
                  <button
                    key={key}
                    type="button"
                    className={`service-tile${on ? " selected" : ""}`}
                    aria-pressed={on}
                    disabled={busy}
                    onClick={() => toggle(key)}
                  >
                    <span className="service-tile-mark" aria-hidden>
                      {on ? "✓" : ""}
                    </span>
                    <span className="service-tile-name">{svc.name}</span>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}

      <div className="actions">
        <button
          className="btn primary"
          disabled={busy || selected.length === 0}
          onClick={() => setConfirm(true)}
        >
          {mode === "secrets-restart" ? "Secrets + restart selected" : "Restart selected"}
        </button>
      </div>

      {logs.length > 0 && <pre className="log">{logs.join("\n")}</pre>}

      {confirm && (
        <div className="modal-backdrop">
          <div className="modal">
            <h2>Confirm Kickflip</h2>
            <p>
              {mode === "secrets-restart" ? "Annotate ExternalSecrets and restart" : "Restart"}{" "}
              {selectedRefs.length} service{selectedRefs.length === 1 ? "" : "s"} on{" "}
              <code>{contextLabel}</code> (<code>{context}</code>).
            </p>
            <ul className="confirm-list">
              {selectedRefs.map((svc) => (
                <li key={keyOf(svc.namespace, svc.name)}>
                  <strong>{svc.namespace}</strong> / {svc.name}
                </li>
              ))}
            </ul>
            <div className="actions">
              <button className="btn" onClick={() => setConfirm(false)}>
                Cancel
              </button>
              <button className="btn primary" disabled={busy} onClick={() => void confirmRun()}>
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

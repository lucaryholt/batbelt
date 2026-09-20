import type { PortInfo } from "../types";
import { api } from "../api";

export function PortsTab({
  ports,
  refresh,
  run,
}: {
  ports: PortInfo[] | null;
  refresh: () => Promise<void>;
  run: (fn: () => Promise<unknown>, ok?: string) => Promise<void>;
}) {
  return (
    <>
      <div className="toolbar">
        <button onClick={() => void refresh()}>↻ Refresh</button>
      </div>
      {!ports && <div className="muted">Loading…</div>}
      {ports && (
        <table className="port-table">
          <thead>
            <tr>
              <th>Port</th>
              <th>Service</th>
              <th>Type</th>
              <th>Status</th>
              <th>Process</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {ports.map((p) => (
              <tr key={`${p.type}-${p.port}-${p.service_name}`}>
                <td>:{p.port}</td>
                <td>{p.service_name}</td>
                <td>{p.type}</td>
                <td>
                  <span className={`pill ${p.status}`}>{p.status}</span>
                </td>
                <td className="muted">{p.process || (p.pid ? `pid ${p.pid}` : "—")}</td>
                <td>
                  {p.status === "external" && p.pid ? (
                    <button
                      className="icon danger"
                      onClick={() => {
                        if (confirm(`Send SIGTERM to pid ${p.pid} on port ${p.port}?`))
                          void run(() => api.killPort(p.port), "Killed").then(() => refresh());
                      }}
                    >
                      Kill
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

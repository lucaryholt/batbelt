import { useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { hostApi } from "./api";
import { useToast } from "./toast";
import type { ModuleDescriptor } from "./types";
import { KubefwdApp } from "../modules/kubefwd/App";
import { SteamerApp } from "../modules/steamer/App";
import { KickflipApp } from "../modules/kickflip/App";

export function App() {
  const [modules, setModules] = useState<ModuleDescriptor[]>([]);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();
  const location = useLocation();

  useEffect(() => {
    void hostApi
      .getModules()
      .then((res) => setModules(res.modules))
      .catch((err: Error) => setError(err.message));
  }, []);

  const first = modules[0];
  const active = modules.find((mod) => location.pathname === `/${mod.id}` || location.pathname.startsWith(`/${mod.id}/`));

  return (
    <div className="bb-shell">
      <aside className="bb-sidebar">
        <div className="bb-brand">
          <strong>batbelt</strong>
          <span>localhost toolbox</span>
        </div>
        <nav className="bb-nav">
          {modules.map((mod) => (
            <div key={mod.id} className="bb-nav-group">
              <NavLink
                to={`/${mod.id}/${mod.pages[0]?.path ?? ""}`}
                className={({ isActive }) => `bb-nav-mod${isActive || active?.id === mod.id ? " active" : ""}`}
              >
                {mod.title}
              </NavLink>
              {(active?.id === mod.id || location.pathname.startsWith(`/${mod.id}`)) &&
                mod.pages.map((page) => (
                  <NavLink
                    key={page.id}
                    to={`/${mod.id}/${page.path}`}
                    className={({ isActive }) => `bb-nav-page${isActive ? " active" : ""}`}
                  >
                    {page.label}
                  </NavLink>
                ))}
            </div>
          ))}
        </nav>
      </aside>
      <div className="bb-workspace">
        {error && <div className="bb-banner">{error}</div>}
        <Routes>
          <Route
            path="/"
            element={first ? <Navigate to={`/${first.id}/${first.pages[0]?.path ?? ""}`} replace /> : <p className="muted">Loading…</p>}
          />
          <Route path="/kubefwd/*" element={<KubefwdApp />} />
          <Route path="/steamer/*" element={<SteamerApp />} />
          <Route path="/kickflip/*" element={<KickflipApp />} />
        </Routes>
      </div>
      {toast && <div className={`toast${toast.error ? " error" : ""}`}>{toast.msg}</div>}
    </div>
  );
}

import { useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import logoUrl from "../../../src-tauri/icons/128x128.png";
import { hostApi } from "./api";
import { useToast } from "./toast";
import type { ModuleDescriptor } from "./types";
import { HomepageApp } from "../modules/homepage/App";
import { KubefwdApp } from "../modules/kubefwd/App";
import { SteamerApp } from "../modules/steamer/App";
import { KickflipApp } from "../modules/kickflip/App";
import { PrlookerApp } from "../modules/prlooker/App";

function modulePath(mod: ModuleDescriptor): string {
  return `/${mod.id}/${mod.pages[0]?.path ?? ""}`;
}

export function App() {
  const [modules, setModules] = useState<ModuleDescriptor[]>([]);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    void hostApi
      .getModules()
      .then((res) => setModules(res.modules))
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      const index = Number(event.key) - 1;
      const mod = Number.isInteger(index) ? modules[index] : undefined;
      if (!mod) return;
      event.preventDefault();
      navigate(modulePath(mod));
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [modules, navigate]);

  const first = modules[0];
  const active = modules.find((mod) => location.pathname === `/${mod.id}` || location.pathname.startsWith(`/${mod.id}/`));

  return (
    <div className="bb-shell">
      <aside className="bb-sidebar">
        <div className="bb-brand">
          <img className="bb-brand-mark" src={logoUrl} alt="" />
          <div className="bb-brand-copy">
            <strong>batbelt</strong>
            <span>localhost toolbox</span>
          </div>
        </div>
        <nav className="bb-nav">
          {modules.map((mod, index) => (
            <div key={mod.id} className="bb-nav-group">
              <NavLink
                to={modulePath(mod)}
                className={({ isActive }) => `bb-nav-mod${isActive || active?.id === mod.id ? " active" : ""}`}
              >
                {mod.title}
                {index < 9 && <span className="bb-nav-key">⌃{index + 1}</span>}
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
            element={first ? <Navigate to={modulePath(first)} replace /> : <p className="muted">Loading…</p>}
          />
          <Route path="/homepage/*" element={<HomepageApp />} />
          <Route path="/kubefwd/*" element={<KubefwdApp />} />
          <Route path="/steamer/*" element={<SteamerApp />} />
          <Route path="/kickflip/*" element={<KickflipApp />} />
          <Route path="/prlooker/*" element={<PrlookerApp />} />
        </Routes>
      </div>
      {toast && <div className={`toast${toast.error ? " error" : ""}`}>{toast.msg}</div>}
    </div>
  );
}

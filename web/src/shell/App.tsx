import { useEffect, useState, type ComponentType } from "react";
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import logoUrl from "../../../src-tauri/icons/128x128.png";
import { hostApi } from "./api";
import { useToast } from "./toast";
import {
  appendTypeToSearchSeed,
  isEditableTarget,
  isHomepageFilterReady,
  peekTypeToSearchSeed,
} from "./typeToSearch";
import type { ModuleDescriptor } from "./types";
import { HomepageApp } from "../modules/homepage/App";
import { KubefwdApp } from "../modules/kubefwd/App";
import { SteamerApp } from "../modules/steamer/App";
import { KickflipApp } from "../modules/kickflip/App";
import { PrlookerApp } from "../modules/prlooker/App";

const MODULE_APPS: Record<string, ComponentType> = {
  homepage: HomepageApp,
  kubefwd: KubefwdApp,
  steamer: SteamerApp,
  kickflip: KickflipApp,
  prlooker: PrlookerApp,
};

function modulePath(mod: ModuleDescriptor): string {
  return `/${mod.id}/${mod.pages[0]?.path ?? ""}`;
}

function digitFromEvent(event: KeyboardEvent): number | undefined {
  const fromCode = /^Digit([1-9])$/.exec(event.code);
  if (fromCode) return Number(fromCode[1]);
  const n = Number(event.key);
  if (Number.isInteger(n) && n >= 1 && n <= 9) return n;
  return undefined;
}

export function App() {
  const [modules, setModules] = useState<ModuleDescriptor[]>([]);
  const [typeToSearch, setTypeToSearch] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    void hostApi
      .getModules()
      .then((res) => {
        setModules(res.modules);
        setTypeToSearch(res.typeToSearch !== false);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.ctrlKey && event.shiftKey && !event.metaKey && !event.altKey) {
        const pageIndex = (digitFromEvent(event) ?? 0) - 1;
        const activeMod = modules.find(
          (mod) => location.pathname === `/${mod.id}` || location.pathname.startsWith(`/${mod.id}/`),
        );
        const page = pageIndex >= 0 ? activeMod?.pages[pageIndex] : undefined;
        if (!page || !activeMod) return;
        event.preventDefault();
        navigate(`/${activeMod.id}/${page.path}`);
        return;
      }

      if (event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
        const index = (digitFromEvent(event) ?? 0) - 1;
        const mod = index >= 0 ? modules[index] : undefined;
        if (!mod) return;
        event.preventDefault();
        navigate(modulePath(mod));
        return;
      }

      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.isComposing || event.key.length !== 1) return;
      if (isEditableTarget(event.target)) return;
      if (!typeToSearch) return;
      const homepage = modules.find((mod) => mod.id === "homepage");
      if (!homepage) return;
      if (isHomepageFilterReady()) return;
      if (event.key === " " && peekTypeToSearchSeed() === "") return;
      event.preventDefault();
      const seed = appendTypeToSearchSeed(event.key);
      navigate(`/${homepage.id}/${homepage.pages[0]?.path ?? "links"}`, {
        state: { typeToSearch: seed },
      });
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [modules, navigate, location.pathname, typeToSearch]);

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
                mod.pages.map((page, pageIndex) => (
                  <NavLink
                    key={page.id}
                    to={`/${mod.id}/${page.path}`}
                    className={({ isActive }) => `bb-nav-page${isActive ? " active" : ""}`}
                  >
                    {page.label}
                    {pageIndex < 9 && <span className="bb-nav-key">⌃⇧{pageIndex + 1}</span>}
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
            element={
              first ? (
                <Navigate to={modulePath(first)} replace />
              ) : loaded ? (
                <p className="muted">
                  No modules enabled. Edit ~/.config/batbelt/modules.yaml and restart batbelt.
                </p>
              ) : (
                <p className="muted">Loading…</p>
              )
            }
          />
          {modules.map((mod) => {
            const ModuleApp = MODULE_APPS[mod.id];
            if (!ModuleApp) return null;
            return <Route key={mod.id} path={`/${mod.id}/*`} element={<ModuleApp />} />;
          })}
        </Routes>
      </div>
      {toast && <div className={`toast${toast.error ? " error" : ""}`}>{toast.msg}</div>}
    </div>
  );
}

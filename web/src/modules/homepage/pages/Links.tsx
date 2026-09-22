import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { getTools, openDirectory, saveConfig } from "../api";
import { buildMatcher, nextTileId, normalizeQuery, type NavDirection } from "../filter";
import type { DirTool, HomepageConfig, Section, Shortcut, ToolsStatus } from "../types";
import { isDirShortcut, isUrlShortcut } from "../types";
import { useToast } from "../../../shell/toast";

function newId(): string {
  return crypto.randomUUID();
}

function PencilIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M11.5 1.8 14.2 4.5 5.7 13H3v-2.7L11.5 1.8Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function StarIcon({ filled }: { filled?: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill={filled ? "currentColor" : "none"} aria-hidden>
      <path
        d="M8 1.6 9.8 5.8l4.5.4-3.4 3 1 4.4L8 11.6 3.9 13.6l1-4.4-3.4-3 4.5-.4L8 1.6Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg className="folder-glyph" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M2 4.5h4.2l1.3 1.4H14V13H2V4.5Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

function starredIds(config: HomepageConfig): string[] {
  return config.starred ?? [];
}

function withStarred(
  config: HomepageConfig,
  sections: Section[],
  starred = starredIds(config),
): HomepageConfig {
  return { ...config, starred, sections };
}

function dropStarredIds(starred: string[], drop: Set<string>): string[] {
  return starred.filter((id) => !drop.has(id));
}

function resolveStarred(config: HomepageConfig): { shortcut: Shortcut; section: Section }[] {
  const byId = new Map<string, { shortcut: Shortcut; section: Section }>();
  for (const section of config.sections) {
    for (const shortcut of section.shortcuts) {
      byId.set(shortcut.id, { shortcut, section });
    }
  }
  const hits: { shortcut: Shortcut; section: Section }[] = [];
  for (const id of starredIds(config)) {
    const hit = byId.get(id);
    if (hit) hits.push(hit);
  }
  return hits;
}

function shortcutTarget(shortcut: Shortcut): string {
  return isDirShortcut(shortcut) ? shortcut.path : shortcut.url;
}

function dirSubtitle(shortcut: Shortcut, terminalKind?: string): string {
  if (!isDirShortcut(shortcut)) return "";
  if (shortcut.tool === "pi" && terminalKind) {
    return `pi · ${terminalKind} · ${shortcut.path}`;
  }
  return `${shortcut.tool} · ${shortcut.path}`;
}

function IconButton({
  label,
  disabled,
  onClick,
  children,
  className,
}: {
  label: string;
  disabled?: boolean;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`icon-btn${className ? ` ${className}` : ""}`}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick(event);
      }}
    >
      {children ?? <PencilIcon />}
    </button>
  );
}

function ShortcutTile({
  shortcut,
  starred,
  locked,
  selected,
  terminalKind,
  tileRef,
  onEdit,
  onStar,
  onOpen,
}: {
  shortcut: Shortcut;
  starred: boolean;
  locked: boolean;
  selected?: boolean;
  terminalKind?: string;
  tileRef?: (el: HTMLElement | null) => void;
  onEdit: () => void;
  onStar: () => void;
  onOpen: () => void;
}) {
  const dir = isDirShortcut(shortcut);
  const className = `shortcut-tile${dir ? " dir" : ""}${selected ? " selected" : ""}`;
  const body = (
    <>
      <div className="shortcut-tile-head">
        <span className="shortcut-label">
          {dir && <FolderIcon />}
          {shortcut.label}
        </span>
        <div className="shortcut-tile-actions">
          <IconButton
            label={starred ? `Unstar ${shortcut.label}` : `Star ${shortcut.label}`}
            className={starred ? "starred" : undefined}
            disabled={locked}
            onClick={onStar}
          >
            <StarIcon filled={starred} />
          </IconButton>
          <IconButton label={`Edit ${shortcut.label}`} disabled={locked} onClick={onEdit} />
        </div>
      </div>
      <span className="muted">{dir ? dirSubtitle(shortcut, terminalKind) : shortcut.url}</span>
    </>
  );

  if (dir) {
    return (
      <button
        type="button"
        ref={tileRef}
        className={className}
        aria-selected={selected}
        onClick={onOpen}
      >
        {body}
      </button>
    );
  }

  return (
    <a
      ref={tileRef as (el: HTMLAnchorElement | null) => void}
      className={className}
      href={shortcut.url}
      target="_blank"
      rel="noopener noreferrer"
      aria-selected={selected}
      onClick={onOpen}
    >
      {body}
    </a>
  );
}

type Modal =
  | { kind: "section"; section?: Section }
  | { kind: "shortcut"; sectionId: string; shortcut?: Shortcut }
  | { kind: "delete-section"; section: Section }
  | { kind: "delete-shortcut"; section: Section; shortcut: Shortcut };

export type LinksPageHandle = {
  addSection: () => void;
};

export const LinksPage = forwardRef<
  LinksPageHandle,
  {
    config: HomepageConfig;
    onChange: (next: HomepageConfig) => void;
  }
>(function LinksPage({ config, onChange }, ref) {
  const [modal, setModal] = useState<Modal | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [sectionTitle, setSectionTitle] = useState("");
  const [sectionLogo, setSectionLogo] = useState("");
  const [shortcutKind, setShortcutKind] = useState<"url" | "dir">("url");
  const [shortcutLabel, setShortcutLabel] = useState("");
  const [shortcutUrl, setShortcutUrl] = useState("");
  const [shortcutPath, setShortcutPath] = useState("");
  const [shortcutTool, setShortcutTool] = useState<DirTool>("code");
  const [tools, setTools] = useState<ToolsStatus | null>(null);
  const [brokenLogos, setBrokenLogos] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const tileRefs = useRef(new Map<string, HTMLElement>());
  const navIdsRef = useRef<string[]>([]);
  const queryRef = useRef(query);
  const selectedIdRef = useRef(selectedId);
  const modalOpenRef = useRef(false);
  const { flash } = useToast();
  queryRef.current = query;
  selectedIdRef.current = selectedId;
  modalOpenRef.current = modal !== null;

  useEffect(() => {
    void getTools()
      .then(setTools)
      .catch(() => setTools(null));
  }, []);

  async function persist(next: HomepageConfig, lockId?: string) {
    setSaving(lockId ?? "all");
    setError(null);
    try {
      onChange(await saveConfig(next));
    } catch (err) {
      setError((err as Error).message);
      throw err;
    } finally {
      setSaving(null);
    }
  }

  function openSection(section?: Section) {
    setSectionTitle(section?.title ?? "");
    setSectionLogo(section?.logo ?? "");
    setModal({ kind: "section", section });
  }

  function openShortcut(sectionId: string, shortcut?: Shortcut) {
    setShortcutKind(shortcut && isDirShortcut(shortcut) ? "dir" : "url");
    setShortcutLabel(shortcut?.label ?? "");
    setShortcutUrl(shortcut && isUrlShortcut(shortcut) ? shortcut.url : "");
    setShortcutPath(shortcut && isDirShortcut(shortcut) ? shortcut.path : "");
    setShortcutTool(shortcut && isDirShortcut(shortcut) ? shortcut.tool : "code");
    setModal({ kind: "shortcut", sectionId, shortcut });
  }

  useImperativeHandle(ref, () => ({
    addSection: () => openSection(),
  }));

  async function saveSection() {
    const title = sectionTitle.trim();
    const logo = sectionLogo.trim();
    if (!title) {
      setError("Title is required");
      return;
    }
    const existing = modal?.kind === "section" ? modal.section : undefined;
    const nextSection: Section = {
      id: existing?.id ?? newId(),
      title,
      collapsed: existing?.collapsed ?? false,
      shortcuts: existing?.shortcuts ?? [],
    };
    if (logo) nextSection.logo = logo;
    const next: HomepageConfig = existing
      ? withStarred(
          config,
          config.sections.map((item) => (item.id === existing.id ? nextSection : item)),
        )
      : withStarred(config, [...config.sections, nextSection]);
    try {
      await persist(next, nextSection.id);
      setModal(null);
      setMessage(existing ? `Updated ${title}.` : `Added ${title}.`);
    } catch {
      /* error already set */
    }
  }

  async function saveShortcut() {
    if (modal?.kind !== "shortcut") return;
    const label = shortcutLabel.trim();
    let nextShortcut: Shortcut;
    if (shortcutKind === "url") {
      const url = shortcutUrl.trim();
      if (!label || !url) {
        setError("Label and URL are required");
        return;
      }
      nextShortcut = { id: modal.shortcut?.id ?? newId(), kind: "url", label, url };
    } else {
      const path = shortcutPath.trim();
      if (!label || !path) {
        setError("Label and path are required");
        return;
      }
      nextShortcut = {
        id: modal.shortcut?.id ?? newId(),
        kind: "dir",
        label,
        path,
        tool: shortcutTool,
      };
    }
    const next: HomepageConfig = withStarred(
      config,
      config.sections.map((section) => {
        if (section.id !== modal.sectionId) return section;
        const shortcuts = modal.shortcut
          ? section.shortcuts.map((item) => (item.id === modal.shortcut?.id ? nextShortcut : item))
          : [...section.shortcuts, nextShortcut];
        return { ...section, shortcuts };
      }),
    );
    try {
      await persist(next, modal.sectionId);
      setModal(null);
      setMessage(modal.shortcut ? `Updated ${label}.` : `Added ${label}.`);
    } catch {
      /* error already set */
    }
  }

  async function toggleCollapsed(section: Section) {
    const next: HomepageConfig = withStarred(
      config,
      config.sections.map((item) =>
        item.id === section.id ? { ...item, collapsed: !item.collapsed } : item,
      ),
    );
    onChange(next);
    try {
      await persist(next, section.id);
    } catch {
      onChange(config);
    }
  }

  async function toggleStar(id: string) {
    const current = starredIds(config);
    const starred = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
    const next = withStarred(config, config.sections, starred);
    onChange(next);
    try {
      await persist(next, "starred");
    } catch {
      onChange(config);
    }
  }

  async function confirmDelete() {
    if (!modal || (modal.kind !== "delete-section" && modal.kind !== "delete-shortcut")) return;
    const next: HomepageConfig =
      modal.kind === "delete-section"
        ? withStarred(
            config,
            config.sections.filter((item) => item.id !== modal.section.id),
            dropStarredIds(starredIds(config), new Set(modal.section.shortcuts.map((s) => s.id))),
          )
        : withStarred(
            config,
            config.sections.map((item) =>
              item.id === modal.section.id
                ? { ...item, shortcuts: item.shortcuts.filter((s) => s.id !== modal.shortcut.id) }
                : item,
            ),
            dropStarredIds(starredIds(config), new Set([modal.shortcut.id])),
          );
    try {
      await persist(next, modal.section.id);
      setModal(null);
      setMessage(
        modal.kind === "delete-section"
          ? `Removed ${modal.section.title}.`
          : `Removed ${modal.shortcut.label}.`,
      );
    } catch {
      /* error already set */
    }
  }

  function stop(event: MouseEvent): void {
    event.stopPropagation();
  }

  function modalActions(extra?: ReactNode) {
    return (
      <div className="modal-actions" style={{ marginTop: 16 }}>
        {extra}
        <div className="actions">
          <button className="btn" onClick={() => setModal(null)}>
            Cancel
          </button>
          {modal?.kind === "section" && (
            <button className="btn primary" disabled={saving !== null} onClick={() => void saveSection()}>
              Save
            </button>
          )}
          {modal?.kind === "shortcut" && (
            <button className="btn primary" disabled={saving !== null} onClick={() => void saveShortcut()}>
              Save
            </button>
          )}
        </div>
      </div>
    );
  }

  const q = normalizeQuery(query);
  const matches = buildMatcher(config.sections, query);
  const allStarred = resolveStarred(config);
  const pinned = new Set(allStarred.map((hit) => hit.shortcut.id));
  const starredHits = allStarred.filter((hit) => matches(hit.shortcut, hit.section));
  const visibleSections = config.sections
    .map((section) => ({
      section,
      shortcuts: section.shortcuts.filter((shortcut) => matches(shortcut, section)),
      expanded: q !== "" || !section.collapsed,
    }))
    .filter((entry) => q === "" || entry.shortcuts.length > 0);
  const noMatches = q !== "" && starredHits.length === 0 && visibleSections.length === 0;

  /** Keyboard order visits each shortcut once: starred hits first, then the rest. */
  const navIds: string[] = [];
  const navSeen = new Set<string>();
  for (const hit of starredHits) {
    if (navSeen.has(hit.shortcut.id)) continue;
    navSeen.add(hit.shortcut.id);
    navIds.push(hit.shortcut.id);
  }
  for (const entry of visibleSections) {
    if (!entry.expanded) continue;
    for (const shortcut of entry.shortcuts) {
      if (navSeen.has(shortcut.id)) continue;
      navSeen.add(shortcut.id);
      navIds.push(shortcut.id);
    }
  }
  navIdsRef.current = navIds;
  const navStarred = new Set(starredHits.map((hit) => hit.shortcut.id));

  function registerTile(id: string) {
    return (el: HTMLElement | null) => {
      if (el) tileRefs.current.set(id, el);
      else tileRefs.current.delete(id);
    };
  }

  function resetFilter() {
    setQuery("");
    setSelectedId(null);
  }

  function handleOpen(shortcut: Shortcut) {
    resetFilter();
    if (!isDirShortcut(shortcut)) return;
    void openDirectory(shortcut.id)
      .then((res) => {
        if (res.fallback === "kitty-window") {
          flash("Kitty remote control failed; opened a new Kitty window.", true);
        }
      })
      .catch((err: Error) => flash(err.message, true));
  }

  const navKey = navIds.join("|");
  useEffect(() => {
    setSelectedId((current) =>
      current && navIdsRef.current.includes(current) ? current : null,
    );
  }, [navKey]);

  useEffect(() => {
    setSelectedId(q === "" ? null : (navIdsRef.current[0] ?? null));
  }, [q]);

  useEffect(() => {
    if (!selectedId) return;
    tileRefs.current.get(selectedId)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selectedId]);

  function moveSelection(direction: NavDirection) {
    const ids = navIdsRef.current;
    if (ids.length === 0) return;
    const current = selectedIdRef.current;
    if (!current || !ids.includes(current)) {
      setSelectedId(ids[0]);
      return;
    }
    const tiles = ids.flatMap((id) => {
      const el = tileRefs.current.get(id);
      if (!el) return [];
      const rect = el.getBoundingClientRect();
      return [{ id, top: rect.top, left: rect.left }];
    });
    setSelectedId(nextTileId(tiles, current, direction));
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (modalOpenRef.current || event.isComposing) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const inFilter = event.target === filterRef.current;
      if (!inFilter && isEditable(event.target)) return;

      const arrows: Record<string, NavDirection> = {
        ArrowUp: "up",
        ArrowDown: "down",
        ArrowLeft: "left",
        ArrowRight: "right",
      };
      const direction = arrows[event.key];
      if (direction) {
        event.preventDefault();
        moveSelection(direction);
        return;
      }

      // A focused link or button activates itself on Enter/Space; don't double up.
      const onControl =
        event.target instanceof HTMLElement && event.target.closest("a, button") !== null;
      if (onControl && (event.key === "Enter" || event.key === " ")) return;

      if (event.key === "Enter") {
        const current = selectedIdRef.current;
        const tile = current ? tileRefs.current.get(current) : undefined;
        if (tile) {
          event.preventDefault();
          tile.click();
        }
        return;
      }

      if (event.key === "Escape") {
        if (queryRef.current !== "") {
          event.preventDefault();
          setQuery("");
        }
        return;
      }
      if (inFilter) return;
      if (event.key === "Backspace") {
        event.preventDefault();
        setQuery((current) => current.slice(0, -1));
        filterRef.current?.focus();
        return;
      }
      if (event.key.length !== 1) return;
      if (event.key === " " && queryRef.current === "") return;
      event.preventDefault();
      setQuery((current) => current + event.key);
      filterRef.current?.focus();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    function clearWhenDismissed() {
      if (document.hidden) resetFilter();
    }
    function onWindowBlur() {
      resetFilter();
    }
    document.addEventListener("visibilitychange", clearWhenDismissed);
    window.addEventListener("pagehide", resetFilter);
    window.addEventListener("blur", onWindowBlur);
    return () => {
      document.removeEventListener("visibilitychange", clearWhenDismissed);
      window.removeEventListener("pagehide", resetFilter);
      window.removeEventListener("blur", onWindowBlur);
    };
  }, []);

  const terminalKind = config.terminal?.kind ?? "terminal-app";

  return (
    <div className="stack">
      {message && <div className="banner ok">{message}</div>}
      {error && <div className="banner bad">{error}</div>}

      <input
        ref={filterRef}
        className="shortcut-filter"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Filter shortcuts — just start typing"
        aria-label="Filter shortcuts"
      />

      {starredHits.length > 0 && (
        <div className="starred-block">
          <h2 className="starred-heading">Starred</h2>
          <div className="shortcut-grid">
            {starredHits.map(({ shortcut, section }) => (
              <ShortcutTile
                key={shortcut.id}
                shortcut={shortcut}
                starred
                selected={selectedId === shortcut.id}
                terminalKind={terminalKind}
                tileRef={registerTile(shortcut.id)}
                locked={saving === section.id || saving === "all" || saving === "starred"}
                onEdit={() => openShortcut(section.id, shortcut)}
                onStar={() => void toggleStar(shortcut.id)}
                onOpen={() => handleOpen(shortcut)}
              />
            ))}
          </div>
        </div>
      )}

      {config.sections.length === 0 && (
        <section className="card">
          <p>No sections yet. Add one — for example Airflow — then add Dev and Prod shortcuts.</p>
        </section>
      )}

      {noMatches && (
        <section className="card">
          <p>
            No shortcuts match <strong>{query.trim()}</strong>.
          </p>
        </section>
      )}

      {visibleSections.map(({ section, shortcuts, expanded }) => {
        const locked = saving === section.id || saving === "all" || saving === "starred";
        return (
          <section
            className="card section-card"
            key={section.id}
            aria-expanded={expanded}
            onClick={() => {
              if (!locked) void toggleCollapsed(section);
            }}
          >
            <div className="env-card-head">
              <div className="section-toggle">
                <span className="chevron" aria-hidden>
                  {expanded ? "▾" : "▸"}
                </span>
                {section.logo && !brokenLogos[section.id] ? (
                  <img
                    className="section-logo"
                    src={section.logo}
                    alt=""
                    onError={() => setBrokenLogos((current) => ({ ...current, [section.id]: true }))}
                  />
                ) : null}
                <strong>{section.title}</strong>
                <span className="muted">
                  {shortcuts.length} shortcut{shortcuts.length === 1 ? "" : "s"}
                </span>
              </div>
              <div className="section-card-actions">
                <IconButton
                  label={`Add shortcut to ${section.title}`}
                  disabled={locked}
                  onClick={() => openShortcut(section.id)}
                >
                  <PlusIcon />
                </IconButton>
                <IconButton label={`Edit ${section.title}`} disabled={locked} onClick={() => openSection(section)} />
              </div>
            </div>
            {expanded && (
              <div className="shortcut-grid" onClick={stop}>
                {shortcuts.map((shortcut) => (
                  <ShortcutTile
                    key={shortcut.id}
                    shortcut={shortcut}
                    starred={pinned.has(shortcut.id)}
                    selected={!navStarred.has(shortcut.id) && selectedId === shortcut.id}
                    terminalKind={terminalKind}
                    tileRef={navStarred.has(shortcut.id) ? undefined : registerTile(shortcut.id)}
                    locked={locked}
                    onEdit={() => openShortcut(section.id, shortcut)}
                    onStar={() => void toggleStar(shortcut.id)}
                    onOpen={() => handleOpen(shortcut)}
                  />
                ))}
              </div>
            )}
          </section>
        );
      })}

      {modal?.kind === "section" && (
        <div className="modal-backdrop">
          <div className="modal">
            <h2>{modal.section ? "Edit section" : "Add section"}</h2>
            <label className="field">
              Title
              <input value={sectionTitle} onChange={(e) => setSectionTitle(e.target.value)} placeholder="Airflow" />
            </label>
            <label className="field" style={{ marginTop: 12 }}>
              Logo URL
              <input
                className="mono"
                value={sectionLogo}
                onChange={(e) => setSectionLogo(e.target.value)}
                placeholder="https://example.com/airflow.svg"
              />
            </label>
            {modalActions(
              modal.section ? (
                <button
                  className="btn danger"
                  disabled={saving !== null}
                  onClick={() => setModal({ kind: "delete-section", section: modal.section! })}
                >
                  Remove
                </button>
              ) : undefined,
            )}
          </div>
        </div>
      )}

      {modal?.kind === "shortcut" && (
        <div className="modal-backdrop">
          <div className="modal">
            <h2>{modal.shortcut ? "Edit shortcut" : "Add shortcut"}</h2>
            <div className="kind-toggle" role="group" aria-label="Shortcut kind">
              <button
                type="button"
                className={`btn small${shortcutKind === "url" ? " primary" : ""}`}
                onClick={() => setShortcutKind("url")}
              >
                URL
              </button>
              <button
                type="button"
                className={`btn small${shortcutKind === "dir" ? " primary" : ""}`}
                onClick={() => setShortcutKind("dir")}
              >
                Folder
              </button>
            </div>
            <label className="field" style={{ marginTop: 12 }}>
              Label
              <input value={shortcutLabel} onChange={(e) => setShortcutLabel(e.target.value)} placeholder="Dev" />
            </label>
            {shortcutKind === "url" ? (
              <label className="field" style={{ marginTop: 12 }}>
                URL
                <input
                  className="mono"
                  value={shortcutUrl}
                  onChange={(e) => setShortcutUrl(e.target.value)}
                  placeholder="https://airflow-dev.example.com"
                />
              </label>
            ) : (
              <>
                <label className="field" style={{ marginTop: 12 }}>
                  Path
                  <input
                    className="mono"
                    value={shortcutPath}
                    onChange={(e) => setShortcutPath(e.target.value)}
                    placeholder="~/scripts/batbelt"
                  />
                </label>
                <label className="field" style={{ marginTop: 12 }}>
                  Open with
                  <select
                    value={shortcutTool}
                    onChange={(e) => setShortcutTool(e.target.value as DirTool)}
                  >
                    {(["code", "pi"] as const).map((tool) => (
                      <option key={tool} value={tool} disabled={tools ? tools[tool] === false : false}>
                        {tool}
                        {tools && tools[tool] === false ? " (not on PATH)" : ""}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
            {modalActions(
              modal.shortcut
                ? (() => {
                    const section = config.sections.find((item) => item.id === modal.sectionId);
                    if (!section) return undefined;
                    return (
                      <button
                        className="btn danger"
                        disabled={saving !== null}
                        onClick={() =>
                          setModal({ kind: "delete-shortcut", section, shortcut: modal.shortcut! })
                        }
                      >
                        Remove
                      </button>
                    );
                  })()
                : undefined,
            )}
          </div>
        </div>
      )}

      {(modal?.kind === "delete-section" || modal?.kind === "delete-shortcut") && (
        <div className="modal-backdrop">
          <div className="modal">
            <h2>Remove {modal.kind === "delete-section" ? "section" : "shortcut"}?</h2>
            {modal.kind === "delete-section" ? (
              <p>
                Remove <strong>{modal.section.title}</strong> and its {modal.section.shortcuts.length} shortcut
                {modal.section.shortcuts.length === 1 ? "" : "s"}?
              </p>
            ) : (
              <p>
                Remove <strong>{modal.shortcut.label}</strong> — <code>{shortcutTarget(modal.shortcut)}</code>?
              </p>
            )}
            <div className="actions" style={{ marginTop: 16 }}>
              <button
                className="btn"
                onClick={() => {
                  if (modal.kind === "delete-section") openSection(modal.section);
                  else openShortcut(modal.section.id, modal.shortcut);
                }}
              >
                Cancel
              </button>
              <button className="btn danger" disabled={saving !== null} onClick={() => void confirmDelete()}>
                Confirm remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

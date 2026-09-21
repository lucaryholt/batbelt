import { forwardRef, useImperativeHandle, useState, type MouseEvent, type ReactNode } from "react";
import { saveConfig } from "../api";
import type { HomepageConfig, Section, Shortcut } from "../types";

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

function starredIds(config: HomepageConfig): string[] {
  return config.starred ?? [];
}

function withStarred(
  config: HomepageConfig,
  sections: Section[],
  starred = starredIds(config),
): HomepageConfig {
  return { starred, sections };
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
  onEdit,
  onStar,
}: {
  shortcut: Shortcut;
  starred: boolean;
  locked: boolean;
  onEdit: () => void;
  onStar: () => void;
}) {
  return (
    <a className="shortcut-tile" href={shortcut.url} target="_blank" rel="noopener noreferrer">
      <div className="shortcut-tile-head">
        <span className="shortcut-label">{shortcut.label}</span>
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
      <span className="muted">{shortcut.url}</span>
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
  const [shortcutLabel, setShortcutLabel] = useState("");
  const [shortcutUrl, setShortcutUrl] = useState("");
  const [brokenLogos, setBrokenLogos] = useState<Record<string, boolean>>({});

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
    setShortcutLabel(shortcut?.label ?? "");
    setShortcutUrl(shortcut?.url ?? "");
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
    const url = shortcutUrl.trim();
    if (!label || !url) {
      setError("Label and URL are required");
      return;
    }
    const nextShortcut: Shortcut = {
      id: modal.shortcut?.id ?? newId(),
      label,
      url,
    };
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

  const starredHits = resolveStarred(config);
  const pinned = new Set(starredHits.map((hit) => hit.shortcut.id));

  return (
    <div className="stack">
      {message && <div className="banner ok">{message}</div>}
      {error && <div className="banner bad">{error}</div>}

      {starredHits.length > 0 && (
        <div className="starred-block">
          <h2 className="starred-heading">Starred</h2>
          <div className="shortcut-grid">
            {starredHits.map(({ shortcut, section }) => (
              <ShortcutTile
                key={shortcut.id}
                shortcut={shortcut}
                starred
                locked={saving === section.id || saving === "all" || saving === "starred"}
                onEdit={() => openShortcut(section.id, shortcut)}
                onStar={() => void toggleStar(shortcut.id)}
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

      {config.sections.map((section) => {
        const locked = saving === section.id || saving === "all" || saving === "starred";
        return (
          <section
            className="card section-card"
            key={section.id}
            aria-expanded={!section.collapsed}
            onClick={() => {
              if (!locked) void toggleCollapsed(section);
            }}
          >
            <div className="env-card-head">
              <div className="section-toggle">
                <span className="chevron" aria-hidden>
                  {section.collapsed ? "▸" : "▾"}
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
                  {section.shortcuts.length} shortcut{section.shortcuts.length === 1 ? "" : "s"}
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
            {!section.collapsed && (
              <div className="shortcut-grid" onClick={stop}>
                {section.shortcuts.map((shortcut) => (
                  <ShortcutTile
                    key={shortcut.id}
                    shortcut={shortcut}
                    starred={pinned.has(shortcut.id)}
                    locked={locked}
                    onEdit={() => openShortcut(section.id, shortcut)}
                    onStar={() => void toggleStar(shortcut.id)}
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
            <label className="field">
              Label
              <input value={shortcutLabel} onChange={(e) => setShortcutLabel(e.target.value)} placeholder="Dev" />
            </label>
            <label className="field" style={{ marginTop: 12 }}>
              URL
              <input
                className="mono"
                value={shortcutUrl}
                onChange={(e) => setShortcutUrl(e.target.value)}
                placeholder="https://airflow-dev.example.com"
              />
            </label>
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
                Remove <strong>{modal.shortcut.label}</strong> — <code>{modal.shortcut.url}</code>?
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

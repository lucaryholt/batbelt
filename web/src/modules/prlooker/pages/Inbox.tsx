import { useEffect, useRef, useState } from "react";
import type { ConfigResponse, InboxItem, InboxResponse, InboxTab } from "../types";

const TABS: { id: InboxTab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "review", label: "Review" },
  { id: "assigned", label: "Assigned" },
  { id: "authored", label: "Authored" },
  { id: "mentioned", label: "Mentioned" },
];

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

function inTab(item: InboxItem, tab: InboxTab): boolean {
  if (tab === "all") return true;
  if (tab === "review") return item.reasons.includes("review") || item.reasons.includes("team");
  return item.reasons.includes(tab);
}

function matchesQuery(item: InboxItem, query: string): boolean {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  const hay = `${item.title} ${item.repository} ${item.author}`.toLowerCase();
  return tokens.every((token) => hay.includes(token));
}

export function relativeTime(iso: string, now = Date.now()): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return iso;
  const sec = Math.max(0, Math.round((now - then) / 1000));
  if (sec < 60) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

function reviewBadge(item: InboxItem): string | null {
  if (item.isDraft) return "Draft";
  if (item.reviewDecision === "APPROVED") return "Approved";
  if (item.reviewDecision === "CHANGES_REQUESTED") return "Changes";
  if (item.reviewDecision === "REVIEW_REQUIRED") return "Review";
  return null;
}

function tabCount(items: InboxItem[], tab: InboxTab): number {
  return items.filter((item) => inTab(item, tab)).length;
}

export function InboxPage({
  inbox,
  config,
  onRefresh,
}: {
  inbox: InboxResponse | null;
  config: ConfigResponse;
  onRefresh: () => Promise<void>;
}) {
  const [tab, setTab] = useState<InboxTab>("all");
  const [query, setQuery] = useState("");
  const filterRef = useRef<HTMLInputElement>(null);
  const queryRef = useRef(query);
  queryRef.current = query;

  useEffect(() => {
    const ms = Math.max(config.pollSeconds, 30) * 1000;
    const timer = window.setInterval(() => {
      if (!document.hidden) void onRefresh();
    }, ms);
    function onVis() {
      if (!document.hidden) void onRefresh();
    }
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [config.pollSeconds, onRefresh]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
      const inFilter = event.target === filterRef.current;
      if (!inFilter && isEditable(event.target)) return;
      if (event.target instanceof HTMLElement && event.target.closest("a, button")) return;
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

  const items = inbox?.items ?? [];
  const visible = items.filter((item) => inTab(item, tab) && matchesQuery(item, query));

  return (
    <div className="stack">
      <input
        ref={filterRef}
        className="inbox-filter"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Filter title, repo, or author — just start typing"
        aria-label="Filter pull requests"
      />

      <div className="inbox-tabs" role="tablist">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={`btn small${tab === item.id ? " primary" : ""}`}
            onClick={() => setTab(item.id)}
          >
            {item.label}
            <span className="tab-count">{tabCount(items, item.id)}</span>
          </button>
        ))}
      </div>

      {inbox && (
        <p className="muted fetched">
          {inbox.viewer ? `@${inbox.viewer} · ` : ""}
          updated {relativeTime(inbox.fetchedAt)}
        </p>
      )}

      {visible.length === 0 && (
        <section className="card">
          <p>
            {items.length === 0
              ? "No open pull requests in this inbox."
              : query.trim()
                ? <>No pull requests match <strong>{query.trim()}</strong>.</>
                : "No pull requests on this tab."}
          </p>
        </section>
      )}

      <div className="pr-list">
        {visible.map((item) => {
          const badge = reviewBadge(item);
          return (
            <a
              key={item.url}
              className="pr-card"
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              <div className="pr-meta">
                <span className="pr-repo">
                  {item.repository} #{item.number}
                </span>
                <span className="muted">{relativeTime(item.updatedAt)}</span>
              </div>
              <strong className="pr-title">{item.title}</strong>
              <div className="pr-foot">
                <span className="muted">{item.author}</span>
                {badge && <span className={`badge${item.isDraft ? " draft" : ""}`}>{badge}</span>}
                {item.reasons.map((reason) => (
                  <span key={reason} className="chip">
                    {reason}
                  </span>
                ))}
              </div>
            </a>
          );
        })}
      </div>
    </div>
  );
}

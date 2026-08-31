"use client";

// Cmd/Ctrl+K palette: page navigation always available; call-log search and
// the theme-toggle action are lazily mounted only while the palette is
// open, so there's no background Supabase subscription cost when it's
// closed (see PaletteModal — a separate child component so its hooks
// actually unmount with it).

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuditTrail } from "@/hooks/use-audit-trail";
import type { AuditRow } from "@/lib/supabase";
import { useTheme } from "./theme-provider";

const PAGES = [
  { label: "Overview", href: "/overview", keywords: "dashboard kpi home" },
  { label: "Call Logs", href: "/call-logs", keywords: "audit trail history events" },
  { label: "Scheduling", href: "/scheduling", keywords: "capacity slots calendar appointments day grid" },
  { label: "Privacy & Data Retention", href: "/compliance", keywords: "privacy guardrail audit retention security" },
  { label: "Billing", href: "/billing", keywords: "invoices plan stripe payment card" },
  { label: "Settings", href: "/settings", keywords: "hours timezone capacity business name" },
] as const;

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.2-3.2" />
    </svg>
  );
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(e: globalThis.KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="hidden items-center gap-2 rounded-lg border border-slate-700 bg-slate-800/60 px-2.5 py-1.5 text-xs text-slate-400 hover:bg-slate-800 md:flex"
      >
        <SearchIcon />
        <span>Search</span>
        <kbd className="ml-1 rounded border border-slate-600 bg-slate-900 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">
          ⌘K
        </kbd>
      </button>
      {open ? <PaletteModal onClose={() => setOpen(false)} /> : null}
    </>
  );
}

type Item =
  | { kind: "page"; key: string; label: string; sub: string; href: string }
  | { kind: "event"; key: string; label: string; sub: string; row: AuditRow }
  | { kind: "action"; key: string; label: string; sub: string; run: () => void };

function PaletteModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { rows } = useAuditTrail();
  const { theme, toggleTheme } = useTheme();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const items = useMemo<Item[]>(() => {
    const q = query.trim().toLowerCase();

    const pages: Item[] = PAGES.filter(
      (p) => !q || p.label.toLowerCase().includes(q) || p.keywords.includes(q)
    ).map((p) => ({ kind: "page", key: p.href, label: p.label, sub: "Page", href: p.href }));

    const events: Item[] =
      q.length < 2
        ? []
        : rows
            .filter((r) => {
              const patient = (r.data.client_name ?? "").toLowerCase();
              const phone = r.phone_tail ?? "";
              const test = (r.data.test_type ?? "").toLowerCase();
              return patient.includes(q) || phone.includes(q) || test.includes(q);
            })
            .slice(0, 8)
            .map((r) => ({
              kind: "event",
              key: `${r.id}-${r.event_id}`,
              label: r.data.client_name ?? `Caller ••• ${r.phone_tail ?? "????"}`,
              sub: `${r.type} · ${new Date(r.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`,
              row: r,
            }));

    const actionLabel = theme === "dark" ? "Switch to light mode" : "Switch to dark mode";
    const actions: Item[] =
      !q || actionLabel.toLowerCase().includes(q)
        ? [{ kind: "action", key: "toggle-theme", label: actionLabel, sub: "Action", run: toggleTheme }]
        : [];

    return [...pages, ...events, ...actions];
  }, [query, rows, theme, toggleTheme]);

  function select(item: Item) {
    if (item.kind === "page") router.push(item.href);
    if (item.kind === "event") router.push("/call-logs");
    if (item.kind === "action") item.run();
    onClose();
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = items[activeIndex];
      if (item) select(item);
    }
  }

  let renderedGroup = "";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-950/60 pt-[12vh]" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-800"
      >
        <div className="flex items-center gap-2.5 border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <span className="text-slate-400 dark:text-slate-500">
            <SearchIcon />
          </span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Jump to a page, search call logs…"
            className="min-w-0 flex-1 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400 dark:text-slate-100 dark:placeholder:text-slate-500"
          />
          <kbd className="rounded border border-slate-300 px-1.5 py-0.5 font-mono text-[10px] text-slate-400 dark:border-slate-600 dark:text-slate-500">
            ESC
          </kbd>
        </div>

        <div className="max-h-[50vh] overflow-y-auto py-1.5">
          {items.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-slate-400">No results.</div>
          ) : (
            items.map((item, i) => {
              const groupLabel = item.kind === "page" ? "Pages" : item.kind === "event" ? "Call Logs" : "Actions";
              const showGroupHeader = groupLabel !== renderedGroup;
              renderedGroup = groupLabel;
              return (
                <div key={item.key}>
                  {showGroupHeader ? (
                    <div className="px-4 pt-2 pb-1 font-mono text-[10px] font-semibold tracking-wider text-slate-400 uppercase dark:text-slate-500">
                      {groupLabel}
                    </div>
                  ) : null}
                  <button
                    onMouseEnter={() => setActiveIndex(i)}
                    onClick={() => select(item)}
                    className={`flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm ${
                      i === activeIndex
                        ? "bg-indigo-50 text-indigo-900 dark:bg-indigo-500/15 dark:text-indigo-200"
                        : "text-slate-700 dark:text-slate-300"
                    }`}
                  >
                    <span className="truncate font-medium">{item.label}</span>
                    <span className="flex-none font-mono text-[10.5px] text-slate-400 dark:text-slate-500">
                      {item.sub}
                    </span>
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

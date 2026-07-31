"use client";

// The highest-stakes event in the system (a possible emergency,
// scripted 911 redirect already delivered) previously had no signal
// beyond someone happening to be looking at the live feed. This adds:
//   - a bell with an unacknowledged-count badge, always in the header
//   - a toast the moment a NEW emergency.detected event arrives this session
//   - an opt-in browser Notification (permission requested from an explicit
//     click here, never proactively — browsers are right to be picky about
//     that) so it's noticeable even if the console tab isn't focused
//
// Email/SMS paging is a real follow-up but needs engine-side work (who to
// page, a provider) — out of scope for a console-only change.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useDashboard } from "./dashboard-provider";
import type { DashboardEvent } from "@/lib/engine";

function BellIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 8a6 6 0 0 1 12 0c0 4 1.5 5.5 2 6H4c.5-.5 2-2 2-6Z" />
      <path d="M9.5 18a2.5 2.5 0 0 0 5 0" />
    </svg>
  );
}

function timeAgo(ts: string) {
  const ms = Date.now() - new Date(ts).getTime();
  const min = Math.round(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function EmergencyAlerts() {
  const router = useRouter();
  const { events } = useDashboard();
  const [open, setOpen] = useState(false);
  const [acknowledged, setAcknowledged] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<DashboardEvent | null>(null);
  // Lazy initializer, not an effect: this only gates a button inside the
  // (initially closed) dropdown, so it never affects the first-paint DOM —
  // no hydration mismatch risk despite reading a browser-only API.
  const [notifyPermission, setNotifyPermission] = useState<NotificationPermission | "unsupported">(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
    return Notification.permission;
  });
  const alertedIds = useRef<Set<string>>(new Set());
  const didMount = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const emergencies = events.filter((e) => e.type === "emergency.detected");
  const unacknowledged = emergencies.filter((e) => !acknowledged.has(e.id));

  // Toast + browser Notification for emergencies that arrive while mounted
  // — not for ones already in the buffer at mount time (those just show up
  // as unacknowledged in the bell, no need to startle with a toast for
  // history).
  useEffect(() => {
    if (!didMount.current) {
      // First run: whatever emergencies are already in the buffer are
      // history, not a new alert — seed them silently, no toast.
      for (const ev of emergencies) alertedIds.current.add(ev.id);
      didMount.current = true;
      return;
    }
    for (const ev of emergencies) {
      if (alertedIds.current.has(ev.id)) continue;
      alertedIds.current.add(ev.id);
      setToast(ev);
      if (toastTimer.current) clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setToast(null), 12000);
      if ("Notification" in window && Notification.permission === "granted") {
        new Notification("Possible emergency", {
          body:
            ev.data.summary ??
            "A caller's language suggested a possible emergency — scripted 911 redirect delivered.",
          tag: ev.id,
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  function toggleOpen() {
    setOpen((o) => {
      const next = !o;
      if (next) setAcknowledged((prev) => new Set([...prev, ...emergencies.map((e) => e.id)]));
      return next;
    });
  }

  function goToLog(ev: DashboardEvent) {
    setOpen(false);
    setToast((t) => (t?.id === ev.id ? null : t));
    router.push("/call-logs?filter=emergency.detected");
  }

  return (
    <>
      {toast ? (
        <div className="fixed top-4 left-1/2 z-50 w-full max-w-md -translate-x-1/2 px-4">
          <div className="flex items-start gap-3 rounded-xl border-2 border-red-400 bg-red-50 p-3.5 shadow-2xl dark:border-red-500/60 dark:bg-red-950">
            <span className="mt-0.5 grid size-7 flex-none place-items-center rounded-full bg-red-600 text-white">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                <path d="M12 3l7 3v6c0 4.5-3 7.7-7 9-4-1.3-7-4.5-7-9V6z" />
                <path d="M12 8v5M12 16.5h.01" />
              </svg>
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-bold text-red-900 dark:text-red-100">
                Possible emergency
              </div>
              <div className="mt-0.5 text-xs leading-relaxed text-red-800 dark:text-red-200">
                {toast.data.summary ?? "Scripted 911 redirect delivered before the model saw the turn."}
              </div>
              <button
                onClick={() => goToLog(toast)}
                className="mt-2 text-[11px] font-semibold text-red-700 underline hover:text-red-900 dark:text-red-300 dark:hover:text-red-100"
              >
                View in Call Logs →
              </button>
            </div>
            <button
              onClick={() => setToast(null)}
              aria-label="Dismiss"
              className="flex-none text-red-400 hover:text-red-700 dark:text-red-400 dark:hover:text-red-200"
            >
              ✕
            </button>
          </div>
        </div>
      ) : null}

      <div className="relative" ref={rootRef}>
        <button
          onClick={toggleOpen}
          aria-label="Emergency alerts"
          className="relative grid size-8 flex-none place-items-center rounded-full text-slate-300 hover:bg-slate-800 hover:text-white"
        >
          <BellIcon />
          {unacknowledged.length > 0 ? (
            <span className="absolute -top-0.5 -right-0.5 grid size-4 place-items-center rounded-full bg-red-600 font-mono text-[9px] font-bold text-white">
              {unacknowledged.length > 9 ? "9+" : unacknowledged.length}
            </span>
          ) : null}
        </button>

        {open ? (
          <div className="absolute top-full right-0 z-50 mt-2 w-80 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-800">
            <div className="border-b border-slate-100 px-3.5 py-2.5 text-xs font-bold text-slate-900 dark:border-slate-700 dark:text-slate-100">
              Emergency redirects
            </div>

            {notifyPermission === "default" ? (
              <button
                onClick={() => Notification.requestPermission().then(setNotifyPermission)}
                className="block w-full border-b border-slate-100 bg-indigo-50 px-3.5 py-2.5 text-left text-[11.5px] font-semibold text-indigo-700 hover:bg-indigo-100 dark:border-slate-700 dark:bg-indigo-500/10 dark:text-indigo-300 dark:hover:bg-indigo-500/20"
              >
                Enable browser alerts, even when this tab isn&apos;t focused →
              </button>
            ) : null}

            {emergencies.length === 0 ? (
              <div className="px-3.5 py-8 text-center text-xs text-slate-400">
                No emergency redirects yet.
              </div>
            ) : (
              <div className="max-h-80 overflow-y-auto">
                {emergencies.map((ev) => (
                  <button
                    key={ev.id}
                    onClick={() => goToLog(ev)}
                    className="block w-full border-b border-slate-100 px-3.5 py-2.5 text-left last:border-b-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/60"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[10.5px] text-slate-400 dark:text-slate-500">
                        ••• {ev.phone_tail ?? "????"} · {ev.channel === "whatsapp" ? "WA" : ev.channel.toUpperCase()}
                      </span>
                      <span className="flex-none font-mono text-[10px] text-slate-400 dark:text-slate-500">
                        {timeAgo(ev.ts)}
                      </span>
                    </div>
                    <div className="mt-0.5 line-clamp-2 text-[11.5px] text-slate-700 dark:text-slate-300">
                      {ev.data.summary ?? "Scripted 911 redirect delivered."}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </>
  );
}

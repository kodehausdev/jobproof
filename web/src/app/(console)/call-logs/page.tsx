"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAuditTrail } from "@/hooks/use-audit-trail";
import { StatusBadge } from "@/components/console/status-badge";
import { useDashboard } from "@/components/console/dashboard-provider";
import type { AuditRow } from "@/lib/supabase";
import { toCsv, downloadCsv } from "@/lib/csv";
import { formatDateTime } from "@/lib/format-time";

const FILTERS = [
  { key: "all", label: "All events" },
  { key: "booking.confirmed", label: "Booked" },
  { key: "booking.cancelled", label: "Cancelled" },
  { key: "guardrail.redacted", label: "Guardrail events" },
  { key: "emergency.detected", label: "Emergency redirects" },
  { key: "call.answered", label: "Answered" },
] as const;

type FilterKey = (typeof FILTERS)[number]["key"];

const RANGES = [
  { key: "all", label: "All time", days: null },
  { key: "today", label: "Today", days: 0 },
  { key: "7d", label: "Last 7 days", days: 7 },
  { key: "30d", label: "Last 30 days", days: 30 },
] as const;

type RangeKey = (typeof RANGES)[number]["key"];

function rangeToDateFrom(key: RangeKey): string | null {
  const range = RANGES.find((r) => r.key === key);
  if (!range || range.days === null) return null;
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - range.days);
  return d.toISOString();
}

function badgeKind(row: AuditRow) {
  if (row.type === "booking.confirmed") return "booked" as const;
  if (row.type === "booking.cancelled") return "cancelled" as const;
  if (row.type === "guardrail.redacted") return "guardrail" as const;
  if (row.type === "emergency.detected") return "emergency" as const;
  if (row.type === "optout.received") return "optedOut" as const;
  if (row.type === "optout.restored") return "optedIn" as const;
  return "answered" as const;
}

function describe(row: AuditRow): { customer: string; test: string; summary: string } {
  const phone = row.phone_tail ? `••• ${row.phone_tail}` : "unknown";
  if (row.type === "booking.confirmed") {
    return {
      customer: row.data.client_name ?? "Caller",
      test: row.data.test_type ?? "—",
      summary:
        row.data.summary ??
        `Booked ${row.data.date} at ${row.data.time_slot} via ${row.channel}.`,
    };
  }
  if (row.type === "booking.cancelled") {
    return {
      customer: `Caller ${phone}`,
      test: row.data.test_type ?? "—",
      summary:
        row.data.summary ??
        `Cancelled ${row.data.date} at ${row.data.time_slot} via ${row.channel}.`,
    };
  }
  if (row.type === "guardrail.redacted") {
    return {
      customer: `Caller ${phone}`,
      test: "—",
      summary:
        row.data.summary ??
        "Restricted content intercepted and redacted by the privacy layer before storage.",
    };
  }
  if (row.type === "emergency.detected") {
    return {
      customer: `Caller ${phone}`,
      test: "—",
      summary:
        row.data.summary ??
        "Caller language suggested a possible emergency — scripted 911 redirect delivered.",
    };
  }
  if (row.type === "optout.received" || row.type === "optout.restored") {
    return {
      customer: `Caller ${phone}`,
      test: "—",
      summary:
        row.data.summary ??
        (row.type === "optout.received"
          ? "Caller opted out of messages via a STOP keyword."
          : "Caller opted back in via a START keyword."),
    };
  }
  return {
    customer: `Caller ${phone}`,
    test: "—",
    summary: `Inbound ${row.channel} conversation answered by the AI.`,
  };
}

export default function CallLogsPage() {
  return (
    <Suspense fallback={null}>
      <CallLogsInner />
    </Suspense>
  );
}

function CallLogsInner() {
  const searchParams = useSearchParams();
  const requestedFilter = searchParams.get("filter");
  const initialFilter: FilterKey = FILTERS.some((f) => f.key === requestedFilter)
    ? (requestedFilter as FilterKey)
    : "all";

  const { tenant } = useDashboard();
  const [range, setRange] = useState<RangeKey>("all");
  const { rows, source, loading, hasMore, loadingMore, loadMore } = useAuditTrail({
    dateFrom: rangeToDateFrom(range),
  });
  const [filter, setFilter] = useState<FilterKey>(initialFilter);

  const visible = rows.filter((r) => filter === "all" || r.type === filter);

  function exportCsv() {
    const csv = toCsv(visible, [
      { header: "Time", get: (r) => new Date(r.created_at).toISOString() },
      { header: "Customer", get: (r) => describe(r).customer },
      { header: "Phone tail", get: (r) => r.phone_tail ?? "" },
      { header: "Channel", get: (r) => r.channel },
      { header: "Requested test", get: (r) => describe(r).test },
      { header: "Type", get: (r) => r.type },
      { header: "AI summary", get: (r) => describe(r).summary },
    ]);
    downloadCsv(`call-logs-${filter}-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[19px] font-bold tracking-tight">Call Logs</h1>
          <p className="mt-0.5 text-[12.5px] text-slate-500 dark:text-slate-400">
            {source === "supabase"
              ? "Durable audit trail · Supabase + Realtime"
              : "Live engine feed (in-memory) — connect Supabase for durable history"}
          </p>
        </div>
        <button
          onClick={exportCsv}
          disabled={visible.length === 0}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          Export CSV
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={
                filter === f.key
                  ? "rounded-full bg-slate-900 px-3.5 py-1.5 text-xs font-semibold text-slate-50 dark:bg-indigo-500/80"
                  : "rounded-full border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
              }
            >
              {f.label}
            </button>
          ))}
        </div>
        <select
          value={range}
          onChange={(e) => setRange(e.target.value as RangeKey)}
          disabled={source === "engine"}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
          title={source === "engine" ? "Date range needs Supabase — the live feed only holds recent events" : undefined}
        >
          {RANGES.map((r) => (
            <option key={r.key} value={r.key}>
              {r.label}
            </option>
          ))}
        </select>
      </div>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:shadow-none">
        <div className="grid grid-cols-[168px_160px_80px_150px_170px_minmax(160px,1fr)] gap-x-3 border-b border-slate-200 bg-slate-50 px-4.5 py-2 dark:border-slate-700 dark:bg-slate-800/50">
          {["Time", "Customer", "Channel", "Requested Test", "Status", "AI Summary"].map(
            (h) => (
              <span
                key={h}
                className="text-[10px] font-bold tracking-wider text-slate-500 uppercase dark:text-slate-400"
              >
                {h}
              </span>
            )
          )}
        </div>

        {loading ? (
          <div className="px-4.5 py-12 text-center text-sm text-slate-400">
            Loading audit trail…
          </div>
        ) : visible.length === 0 ? (
          <div className="px-4.5 py-12 text-center text-sm text-slate-400">
            No events match this filter yet.
          </div>
        ) : (
          visible.map((row) => {
            const d = describe(row);
            return (
              <div
                key={`${row.id}-${row.event_id}`}
                className={`grid grid-cols-[168px_160px_80px_150px_170px_minmax(160px,1fr)] items-center gap-x-3 border-b border-slate-100 px-4.5 py-2.5 dark:border-slate-800 ${
                  row.type === "guardrail.redacted" || row.type === "emergency.detected"
                    ? "bg-red-50/60 dark:bg-red-500/5"
                    : ""
                }`}
              >
                <span className="font-mono text-[11.5px] text-slate-500 dark:text-slate-400">
                  {formatDateTime(row.created_at, tenant?.timezone)}
                </span>
                <div className="min-w-0">
                  <div className="truncate text-[12.5px] font-semibold">
                    {d.customer}
                  </div>
                  <div className="font-mono text-[10.5px] text-slate-400 dark:text-slate-500">
                    {row.phone_tail ? `••• ${row.phone_tail}` : ""}
                  </div>
                </div>
                <span
                  className={
                    row.channel === "whatsapp"
                      ? "justify-self-start rounded-md bg-green-50 px-2 py-0.5 font-mono text-[10px] font-semibold text-green-700 dark:bg-green-500/10 dark:text-green-300"
                      : "justify-self-start rounded-md bg-indigo-50 px-2 py-0.5 font-mono text-[10px] font-semibold text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300"
                  }
                >
                  {row.channel === "whatsapp" ? "WA" : "VOICE"}
                </span>
                <span className="truncate text-xs font-medium text-slate-700 dark:text-slate-300">
                  {d.test}
                </span>
                <div>
                  <StatusBadge kind={badgeKind(row)} />
                </div>
                <span className="min-w-0 truncate text-[11.5px] text-slate-500 dark:text-slate-400">
                  {d.summary}
                </span>
              </div>
            );
          })
        )}

        {hasMore ? (
          <div className="border-b border-slate-100 px-4.5 py-2.5 text-center dark:border-slate-800">
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          </div>
        ) : null}

        <div className="flex items-center justify-between bg-slate-50 px-4.5 py-2.5 dark:bg-slate-800/50">
          <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
            SHOWING {visible.length} EVENT{visible.length === 1 ? "" : "S"}
          </span>
          <span className="font-mono text-[11px] text-slate-400 dark:text-slate-500">
            EVENT METADATA ONLY — NO CALLER CONTENT IS EVER LOGGED
          </span>
        </div>
      </section>
    </div>
  );
}

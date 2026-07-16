"use client";

// Durable audit rows for Call Logs / Compliance.
// Source of truth is Supabase (initial page + Realtime INSERTs, cursor
// pagination via "Load more"). When Supabase env isn't configured (local
// dev before keys exist), the hook degrades to mirroring the engine's live
// SSE feed so the pages still work — they just don't survive an engine
// restart, and there's nothing to paginate beyond the in-memory ring buffer.

import { useEffect, useId, useMemo, useState } from "react";
import { supabase, type AuditRow } from "@/lib/supabase";
import { eventSeq, type DashboardEvent } from "@/lib/engine";
import { useDashboard } from "@/components/console/dashboard-provider";

const PAGE_SIZE = 100;

function rowFromEvent(ev: DashboardEvent): AuditRow {
  return {
    id: eventSeq(ev),
    tenant_id: ev.tenant_id,
    event_id: ev.id,
    type: ev.type,
    channel: ev.channel,
    phone_tail: ev.phone_tail,
    data: ev.data,
    created_at: ev.ts,
  };
}

export function useAuditTrail(opts?: { dateFrom?: string | null }): {
  rows: AuditRow[];
  source: "supabase" | "engine";
  loading: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  loadMore: () => void;
} {
  const dateFrom = opts?.dateFrom ?? null;
  // Unique per hook instance — two callers with the same dateFrom (e.g. the
  // Call Logs page and the command palette both open at once) must not
  // share a Realtime channel name. Supabase's client keys channels by name
  // and throws "cannot add postgres_changes callbacks... after subscribe()"
  // if a second .on() lands on an already-subscribed channel of that name.
  const instanceId = useId().replace(/[^a-zA-Z0-9]/g, "");
  const { events } = useDashboard();
  // Keyed by dateFrom so a range change is visible as "reload" without a
  // synchronous setState at the top of the effect (same pattern as
  // use-appointments.ts).
  const [state, setState] = useState<{ dateFrom: string | null; rows: AuditRow[]; hasMore: boolean } | null>(
    null
  );
  const [loadingMore, setLoadingMore] = useState(false);
  const fresh = state?.dateFrom === dateFrom;
  const loading = Boolean(supabase) && !fresh;

  useEffect(() => {
    const sb = supabase;
    if (!sb) return;
    let disposed = false;

    let query = sb.from("audit_events").select("*").order("created_at", { ascending: false }).limit(PAGE_SIZE);
    if (dateFrom) query = query.gte("created_at", dateFrom);

    query.then(({ data, error }) => {
      if (disposed) return;
      if (!error && data) {
        setState({ dateFrom, rows: data as AuditRow[], hasMore: data.length === PAGE_SIZE });
      }
    });

    const channel = sb
      .channel(`audit-inserts-${dateFrom ?? "all"}-${instanceId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "audit_events" },
        (payload) => {
          const row = payload.new as AuditRow;
          if (dateFrom && row.created_at < dateFrom) return;
          setState((prev) => {
            if (!prev || prev.dateFrom !== dateFrom) return prev;
            if (prev.rows.some((r) => r.id === row.id)) return prev;
            return { ...prev, rows: [row, ...prev.rows] };
          });
        }
      )
      .subscribe();

    return () => {
      disposed = true;
      sb.removeChannel(channel);
    };
  }, [dateFrom, instanceId]);

  function loadMore() {
    const sb = supabase;
    if (!sb || !state || state.dateFrom !== dateFrom || !state.hasMore || loadingMore) return;
    const cursor = state.rows[state.rows.length - 1]?.created_at;
    if (!cursor) return;
    setLoadingMore(true);
    let query = sb
      .from("audit_events")
      .select("*")
      .order("created_at", { ascending: false })
      .lt("created_at", cursor)
      .limit(PAGE_SIZE);
    if (dateFrom) query = query.gte("created_at", dateFrom);

    query.then(({ data, error }) => {
      setLoadingMore(false);
      if (error || !data) return;
      setState((prev) => {
        if (!prev || prev.dateFrom !== dateFrom) return prev;
        const existing = new Set(prev.rows.map((r) => r.id));
        const appended = (data as AuditRow[]).filter((r) => !existing.has(r.id));
        return { ...prev, rows: [...prev.rows, ...appended], hasMore: data.length === PAGE_SIZE };
      });
    });
  }

  const engineRows = useMemo(() => {
    const mapped = events.map(rowFromEvent);
    return dateFrom ? mapped.filter((r) => r.created_at >= dateFrom) : mapped;
  }, [events, dateFrom]);

  if (supabase) {
    return {
      rows: fresh ? state.rows : [],
      source: "supabase",
      loading,
      hasMore: fresh ? state.hasMore : false,
      loadingMore,
      loadMore,
    };
  }
  return {
    rows: engineRows,
    source: "engine",
    loading: false,
    hasMore: false,
    loadingMore: false,
    loadMore: () => {},
  };
}

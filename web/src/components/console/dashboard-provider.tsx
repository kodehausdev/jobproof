"use client";

// Data source for the console. Two modes:
//
//   engine — the local engine's SSE feed. Only adopted when the engine's
//            configured tenant MATCHES the signed-in user's tenant (or in
//            keyless dev, where there is no auth). Prevents one lab's live
//            feed from rendering in another lab's console.
//   db     — Supabase audit trail (RLS-scoped) + Realtime inserts. Used when
//            the signed-in tenant isn't the one the engine serves (e.g. a
//            freshly onboarded lab whose phone line isn't provisioned yet),
//            or when the engine is unreachable.
//
// status drives the header badge:
//   engine-live | engine-unlinked (db mode, engine serves another tenant
//   or is down) | offline (keyless dev, engine down)

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ENGINE_URL,
  eventSeq,
  type Counters,
  type DashboardEvent,
  type EngineState,
} from "@/lib/engine";
import { supabase, type AuditRow } from "@/lib/supabase";
import { useAuth } from "@/components/auth/auth-gate";

export type FeedStatus = "connecting" | "engine-live" | "engine-unlinked" | "offline";

interface DashboardContextValue {
  status: FeedStatus;
  tenant: EngineState["tenant"] | null;
  counters: Counters;
  events: DashboardEvent[]; // newest first
}

const EMPTY_COUNTERS: Counters = {
  calls_answered: 0,
  bookings_confirmed: 0,
  guardrail_events: 0,
  emergency_events: 0,
};

const DashboardContext = createContext<DashboardContextValue>({
  status: "connecting",
  tenant: null,
  counters: EMPTY_COUNTERS,
  events: [],
});

export function useDashboard() {
  return useContext(DashboardContext);
}

function eventFromAuditRow(row: AuditRow): DashboardEvent {
  return {
    id: `evt-${row.id}`,
    type: row.type,
    ts: row.created_at,
    tenant_id: row.tenant_id ?? "unknown",
    channel: row.channel,
    phone_tail: row.phone_tail,
    data: row.data ?? {},
  };
}

export function DashboardProvider({ children }: { children: ReactNode }) {
  const { tenant: authTenant } = useAuth();
  const [status, setStatus] = useState<FeedStatus>("connecting");
  const [engineTenant, setEngineTenant] = useState<EngineState["tenant"] | null>(null);
  const [counters, setCounters] = useState<Counters>(EMPTY_COUNTERS);
  const [events, setEvents] = useState<DashboardEvent[]>([]);
  const watermark = useRef(0);
  // Waiting for the tenant row when authed: avoids adopting the engine feed
  // before we know who the user is.
  const authPending = Boolean(supabase) && !authTenant;

  // ── engine mode ─────────────────────────────────────────────
  useEffect(() => {
    if (authPending) return;
    let disposed = false;
    let dbMode = false;
    let engineAdopted = false;
    let es: EventSource | null = null;

    const ingest = (ev: DashboardEvent) => {
      if (disposed || dbMode) return;
      if (authTenant && ev.tenant_id !== authTenant.id) return;
      setEvents((prev) => {
        if (prev.some((e) => e.id === ev.id)) return prev;
        return [ev, ...prev].slice(0, 100);
      });
      if (eventSeq(ev) > watermark.current) {
        watermark.current = eventSeq(ev);
        setCounters((c) => ({
          calls_answered: c.calls_answered + (ev.type === "call.answered" ? 1 : 0),
          bookings_confirmed:
            c.bookings_confirmed + (ev.type === "booking.confirmed" ? 1 : 0),
          guardrail_events:
            c.guardrail_events + (ev.type === "guardrail.redacted" ? 1 : 0),
          emergency_events:
            c.emergency_events + (ev.type === "emergency.detected" ? 1 : 0),
        }));
      }
    };

    const fallBackToDb = () => {
      if (disposed || dbMode) return;
      dbMode = true;
      es?.close();
      if (authTenant && supabase) {
        setStatus("engine-unlinked");
        void hydrateFromDb();
      } else {
        setStatus("offline");
      }
    };

    const hydrateFromDb = async () => {
      const sb = supabase;
      if (!sb || !authTenant) return;
      const [answered, booked, guarded, emergencies, rows] = await Promise.all([
        sb.from("audit_events").select("id", { count: "exact", head: true }).eq("type", "call.answered"),
        sb.from("audit_events").select("id", { count: "exact", head: true }).eq("type", "booking.confirmed"),
        sb.from("audit_events").select("id", { count: "exact", head: true }).eq("type", "guardrail.redacted"),
        sb.from("audit_events").select("id", { count: "exact", head: true }).eq("type", "emergency.detected"),
        sb.from("audit_events").select("*").order("id", { ascending: false }).limit(100),
      ]);
      if (disposed) return;
      setCounters({
        calls_answered: answered.count ?? 0,
        bookings_confirmed: booked.count ?? 0,
        guardrail_events: guarded.count ?? 0,
        emergency_events: emergencies.count ?? 0,
      });
      setEvents(((rows.data as AuditRow[]) ?? []).map(eventFromAuditRow));

      const channel = sb
        .channel("dashboard-audit")
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "audit_events" },
          (payload) => {
            const row = payload.new as AuditRow;
            if (row.tenant_id !== authTenant.id) return;
            setEvents((prev) =>
              prev.some((e) => e.id === `evt-${row.id}`)
                ? prev
                : [eventFromAuditRow(row), ...prev].slice(0, 100)
            );
            setCounters((c) => ({
              calls_answered: c.calls_answered + (row.type === "call.answered" ? 1 : 0),
              bookings_confirmed:
                c.bookings_confirmed + (row.type === "booking.confirmed" ? 1 : 0),
              guardrail_events:
                c.guardrail_events + (row.type === "guardrail.redacted" ? 1 : 0),
              emergency_events:
                c.emergency_events + (row.type === "emergency.detected" ? 1 : 0),
            }));
          }
        )
        .subscribe();
      cleanupRealtime = () => sb.removeChannel(channel);
    };

    let cleanupRealtime: (() => void) | null = null;

    // The deployed engine requires a Supabase user token (?token= because
    // EventSource can't set headers). Keyless dev sends none — the engine
    // is open in that mode too. Token also pins the tenant server-side.
    const setup = async () => {
      const qs = new URLSearchParams();
      if (authTenant) qs.set("tenant", authTenant.id);
      if (supabase && authTenant) {
        const { data } = await supabase.auth.getSession();
        if (data.session?.access_token) qs.set("token", data.session.access_token);
      }
      if (disposed) return;
      const scope = qs.size ? `?${qs.toString()}` : "";
      es = new EventSource(`${ENGINE_URL}/api/dashboard/events${scope}`);

      es.onopen = async () => {
      try {
        const res = await fetch(`${ENGINE_URL}/api/dashboard/state${scope}`);
        // 404 = this tenant has no line provisioned on the engine.
        if (!res.ok) {
          fallBackToDb();
          return;
        }
        const state: EngineState = await res.json();
        if (disposed) return;
        setEngineTenant(state.tenant);

        // Belt and braces: never adopt a feed for a different tenant.
        if (authTenant && state.tenant.id !== authTenant.id) {
          fallBackToDb();
          return;
        }

        setCounters(state.counters);
        watermark.current = Math.max(
          watermark.current,
          ...state.recent.map(eventSeq),
          0
        );
        setEvents((prev) => {
          const byId = new Map([...state.recent, ...prev].map((e) => [e.id, e]));
          return [...byId.values()].sort((a, b) => eventSeq(b) - eventSeq(a));
        });
        engineAdopted = true;
        setStatus("engine-live");
      } catch {
        fallBackToDb();
      }
    };

      es.onmessage = (m) => {
        try {
          ingest(JSON.parse(m.data) as DashboardEvent);
        } catch {
          /* ignore malformed frames */
        }
      };

      es.onerror = () => {
        // Never adopted the engine feed → use the durable trail instead.
        // (Once adopted, EventSource auto-reconnects and onopen re-syncs.)
        if (!engineAdopted) fallBackToDb();
      };
    };

    void setup();

    return () => {
      disposed = true;
      es?.close();
      if (cleanupRealtime) cleanupRealtime();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authPending, authTenant?.id]);

  const tenant = authTenant ?? engineTenant;

  return (
    <DashboardContext.Provider value={{ status, tenant, counters, events }}>
      {children}
    </DashboardContext.Provider>
  );
}

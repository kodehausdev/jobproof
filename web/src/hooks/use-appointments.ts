"use client";

// Confirmed appointments for one day — backs the Scheduling grid.
// Source of truth is Supabase (RLS-scoped) + Realtime for that date. When
// Supabase env isn't configured, degrades to deriving today's bookings from
// the engine's live event feed (booking.confirmed / booking.cancelled),
// same resilience pattern as use-audit-trail.

import { useEffect, useId, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useDashboard } from "@/components/console/dashboard-provider";

export interface Appointment {
  id: number;
  patient_name: string;
  phone_number: string;
  test_type: string;
  date: string; // YYYY-MM-DD
  time_slot: string; // HH:MM
  channel: "voice" | "sms" | "whatsapp";
  status: "confirmed" | "cancelled" | "completed";
  created_at: string;
}

export function useAppointments(date: string): {
  appointments: Appointment[];
  source: "supabase" | "engine";
  loading: boolean;
} {
  // Unique per hook instance — see use-audit-trail.ts for why two callers
  // must never share a Realtime channel name.
  const instanceId = useId().replace(/[^a-zA-Z0-9]/g, "");
  const { events } = useDashboard();
  // Keyed by date so a date change is visible as "no data for this date yet"
  // (loading) without a synchronous setState at the top of the effect.
  const [state, setState] = useState<{ date: string; rows: Appointment[] } | null>(null);
  const loading = Boolean(supabase) && state?.date !== date;

  useEffect(() => {
    const sb = supabase;
    if (!sb) return;
    let disposed = false;

    sb.from("appointments")
      .select("*")
      .eq("date", date)
      .eq("status", "confirmed")
      .order("created_at", { ascending: true })
      .then(({ data, error }) => {
        if (disposed) return;
        if (!error && data) setState({ date, rows: data as Appointment[] });
      });

    const channel = sb
      .channel(`appointments-${date}-${instanceId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "appointments", filter: `date=eq.${date}` },
        (payload) => {
          setState((prev) => {
            const list = prev?.date === date ? prev.rows : [];
            if (payload.eventType === "DELETE") {
              return { date, rows: list.filter((a) => a.id !== (payload.old as Appointment).id) };
            }
            const row = payload.new as Appointment;
            const withoutRow = list.filter((a) => a.id !== row.id);
            // Only confirmed rows belong on the live grid — mirrors the
            // engine's own capacity count (countBookings only counts
            // status === 'confirmed').
            if (row.status !== "confirmed") return { date, rows: withoutRow };
            return {
              date,
              rows: [...withoutRow, row].sort((a, b) =>
                a.created_at.localeCompare(b.created_at)
              ),
            };
          });
        }
      )
      .subscribe();

    return () => {
      disposed = true;
      sb.removeChannel(channel);
    };
  }, [date, instanceId]);

  const engineRows = useMemo<Appointment[]>(() => {
    const byId = new Map<number, Appointment>();
    // Oldest first, so later events (incl. cancellations) win.
    for (const ev of [...events].reverse()) {
      const bookingId = ev.data.booking_id;
      if (bookingId == null || ev.data.date !== date) continue;
      if (ev.type === "booking.confirmed") {
        byId.set(bookingId, {
          id: bookingId,
          patient_name: ev.data.patient_name ?? "Caller",
          phone_number: "",
          test_type: ev.data.test_type ?? "—",
          date: ev.data.date,
          time_slot: ev.data.time_slot ?? "",
          channel: ev.channel === "whatsapp" ? "whatsapp" : "voice",
          status: "confirmed",
          created_at: ev.ts,
        });
      } else if (ev.type === "booking.cancelled") {
        byId.delete(bookingId);
      }
    }
    return [...byId.values()];
  }, [events, date]);

  if (supabase) {
    return { appointments: state?.date === date ? state.rows : [], source: "supabase", loading };
  }
  return { appointments: engineRows, source: "engine", loading: false };
}

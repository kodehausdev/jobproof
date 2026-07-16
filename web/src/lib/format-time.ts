// Every console timestamp used to render with bare toLocaleString/
// toLocaleTimeString — no timeZone option means "whatever zone the
// viewer's browser happens to be in," with no indication which zone that
// even was. For a scheduling product a lab in Chicago viewed by someone in
// Lagos should always show Chicago time, not the viewer's. These format
// against the tenant's configured timezone (Settings → Timezone) when
// known, and always append the zone abbreviation so it's unambiguous even
// when it falls back to the viewer's local zone.

function safeFormat(date: Date, opts: Intl.DateTimeFormatOptions, timeZone?: string | null): string {
  if (timeZone) {
    try {
      return date.toLocaleString("en-US", { ...opts, timeZone });
    } catch {
      // Bad/legacy timezone value on the tenant row — don't take the whole
      // page down over a display nicety, just fall through to the
      // viewer's own zone below.
    }
  }
  return date.toLocaleString("en-US", opts);
}

export function formatDateTime(iso: string, timeZone?: string | null): string {
  return safeFormat(
    new Date(iso),
    { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" },
    timeZone
  );
}

export function formatTime(iso: string, timeZone?: string | null): string {
  return safeFormat(
    new Date(iso),
    { hour: "numeric", minute: "2-digit", timeZoneName: "short" },
    timeZone
  );
}

// Date-only (no time-of-day), for headers like Overview's "Thursday, July
// 16, 2026" — the lab's own calendar day, not the viewer's, since it's
// paired directly with the lab's identity and matters near midnight.
export function formatLongDate(date: Date, timeZone?: string | null): string {
  return safeFormat(
    date,
    { weekday: "long", month: "long", day: "numeric", year: "numeric" },
    timeZone
  );
}

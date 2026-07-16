import type { ReactNode } from "react";

// Fixed set so Tailwind's JIT sees the full class strings (no dynamic
// construction) — matches the pattern in status-badge.tsx.
const ACCENTS = {
  indigo: {
    bar: "bg-indigo-500",
    chip: "bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300",
  },
  violet: {
    bar: "bg-violet-500",
    chip: "bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300",
  },
  amber: {
    bar: "bg-amber-500",
    chip: "bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300",
  },
  green: {
    bar: "bg-emerald-500",
    chip: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300",
  },
} as const;

export type KpiAccent = keyof typeof ACCENTS;

export function KpiCard({
  label,
  value,
  sub,
  icon,
  accent = "indigo",
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  accent?: KpiAccent;
}) {
  const a = ACCENTS[accent];
  return (
    <div className="group relative overflow-hidden rounded-xl border border-slate-200/80 bg-white px-4.5 py-4 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_20px_-14px_rgba(15,23,42,0.25)] transition-shadow duration-150 hover:shadow-[0_1px_2px_rgba(15,23,42,0.06),0_16px_28px_-16px_rgba(15,23,42,0.3)] dark:border-slate-700/80 dark:bg-slate-900 dark:shadow-none">
      <span className={`absolute inset-x-0 top-0 h-[3px] ${a.bar}`} />
      <div className="flex items-center justify-between">
        <span className="text-[11.5px] font-semibold tracking-wider text-slate-500 uppercase dark:text-slate-400">
          {label}
        </span>
        {icon ? (
          <span
            className={`grid size-7 flex-none place-items-center rounded-lg ${a.chip}`}
          >
            {icon}
          </span>
        ) : null}
      </div>
      <div className="mt-2.5 text-[32px] font-bold leading-none tracking-tight dark:text-slate-100">
        {value}
      </div>
      {sub ? <div className="mt-1.5 text-xs text-slate-600 dark:text-slate-400">{sub}</div> : null}
    </div>
  );
}

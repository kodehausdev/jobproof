"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useDashboard } from "./dashboard-provider";
import { UserMenu } from "./user-menu";
import { CommandPalette } from "./command-palette";
import { EmergencyAlerts } from "./emergency-alerts";

const TABS = [
  { href: "/overview", label: "Overview" },
  { href: "/call-logs", label: "Call Logs" },
  { href: "/scheduling", label: "Scheduling" },
  { href: "/billing", label: "Billing" },
  { href: "/team", label: "Team" },
  { href: "/settings", label: "Settings" },
];

function WrenchLogo() {
  return (
    <div className="grid size-8 flex-none place-items-center rounded-lg bg-gradient-to-br from-indigo-600 to-blue-600">
      <svg
        width="17"
        height="17"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#fff"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
      </svg>
    </div>
  );
}

const BADGE = {
  "engine-live": {
    box: "border-emerald-500/40 bg-emerald-500/15",
    dot: "bg-emerald-400 [animation:pulse-dot_1.6s_ease-in-out_infinite]",
    text: "text-emerald-300",
    label: "ENGINE LIVE",
  },
  "engine-unlinked": {
    box: "border-amber-500/40 bg-amber-500/10",
    dot: "bg-amber-400",
    text: "text-amber-300",
    label: "LINE NOT PROVISIONED",
  },
  offline: {
    box: "border-slate-600 bg-slate-800",
    dot: "bg-slate-500",
    text: "text-slate-400",
    label: "ENGINE OFFLINE",
  },
  connecting: {
    box: "border-slate-600 bg-slate-800",
    dot: "bg-slate-500 [animation:pulse-dot_1.2s_ease-in-out_infinite]",
    text: "text-slate-400",
    label: "CONNECTING…",
  },
} as const;

function NavLinks({ className, linkClassName }: { className: string; linkClassName?: string }) {
  const pathname = usePathname();
  return (
    <nav className={className}>
      {TABS.map((tab) => {
        const active = pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`flex-none whitespace-nowrap rounded-md px-3 py-1.5 text-[13px] font-medium ${linkClassName ?? ""} ${
              active
                ? "bg-indigo-500/25 font-semibold text-indigo-200"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function ConsoleHeader() {
  const { status, tenant } = useDashboard();
  const badge = BADGE[status];

  return (
    <header className="sticky top-0 z-40 bg-slate-900 text-slate-50 shadow">
      <div className="mx-auto flex max-w-[1440px] flex-col gap-2 px-4 py-2.5 md:h-15 md:flex-row md:items-center md:gap-4 md:px-6 md:py-0">
        <div className="flex items-center justify-between gap-3 md:contents">
          <div className="flex min-w-0 items-center gap-3">
            <WrenchLogo />
            <div className="min-w-0 leading-tight">
              <div className="truncate text-sm font-bold tracking-tight">
                {tenant?.lab_name ?? "Jobproof"}
              </div>
              <div className="font-mono text-[10.5px] text-slate-400">
                JOBPROOF · CONSOLE
              </div>
            </div>
          </div>

          <NavLinks className="hidden md:ml-5 md:flex md:gap-0.5" />

          <div className="flex flex-none items-center gap-2.5 md:ml-auto md:gap-3.5">
            <CommandPalette />
            <EmergencyAlerts />
            <div
              className={`flex items-center gap-2 rounded-full border px-2.5 py-1 md:px-3 md:py-1.5 ${badge.box}`}
            >
              <span className={`size-1.5 flex-none rounded-full ${badge.dot}`} />
              <span
                className={`hidden font-mono text-[11px] font-semibold sm:inline ${badge.text}`}
              >
                {badge.label}
              </span>
            </div>
            <UserMenu />
          </div>
        </div>

        <NavLinks
          className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-0.5 md:hidden"
          linkClassName="text-[12.5px]"
        />
      </div>
    </header>
  );
}

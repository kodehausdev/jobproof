"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth/auth-gate";
import { useDashboard } from "./dashboard-provider";
import { useTheme } from "./theme-provider";

export function UserMenu() {
  const { user, signOut } = useAuth();
  const { tenant } = useDashboard();
  const { theme, toggleTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const initials = (user?.email ?? "dev")
    .split("@")[0]
    .split(/[._-]/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="relative" ref={rootRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={user?.email ?? "local dev (no auth)"}
        className="grid size-8 flex-none place-items-center rounded-full bg-slate-700 text-xs font-bold text-slate-300 outline-none hover:bg-slate-600"
      >
        {initials}
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute top-full right-0 z-50 mt-2 w-56 overflow-hidden rounded-lg border border-slate-200 bg-white py-1.5 text-slate-900 shadow-lg dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
        >
          <div className="border-b border-slate-100 px-3.5 py-2.5 dark:border-slate-700">
            <div className="truncate text-xs font-semibold">
              {user?.email ?? "Local dev"}
            </div>
            <div className="mt-0.5 truncate text-[11px] text-slate-400">
              {tenant?.lab_name ?? "No tenant linked"}
            </div>
          </div>
          <Link
            href="/settings"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            Settings
          </Link>
          <Link
            href="/billing"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            Billing
          </Link>
          <button
            role="menuitemcheckbox"
            aria-checked={theme === "dark"}
            onClick={toggleTheme}
            className="flex w-full items-center justify-between border-t border-slate-100 px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            <span>Dark mode</span>
            <span
              className={`relative h-4.5 w-8 flex-none rounded-full transition-colors ${
                theme === "dark" ? "bg-indigo-600" : "bg-slate-300"
              }`}
            >
              <span
                className={`absolute top-0.5 size-3.5 rounded-full bg-white transition-transform ${
                  theme === "dark" ? "translate-x-4" : "translate-x-0.5"
                }`}
              />
            </span>
          </button>
          {user ? (
            <button
              role="menuitem"
              onClick={() => {
                setOpen(false);
                void signOut();
              }}
              className="block w-full border-t border-slate-100 px-3.5 py-2 text-left text-xs font-medium text-red-600 hover:bg-red-50 dark:border-slate-700 dark:text-red-400 dark:hover:bg-red-950/40"
            >
              Sign out
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

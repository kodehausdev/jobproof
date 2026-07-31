"use client";

// Scoped to the console shell subtree (not <html>) so login/signup — which
// use a separate cream/terracotta onboarding palette — are never affected
// by this toggle. See globals.css for the matching `@custom-variant dark`
// that makes `dark:` classes key off this wrapper's class instead of the
// OS-level prefers-color-scheme media query.
//
// Uses useSyncExternalStore rather than useState+useEffect: the persisted
// theme is only knowable client-side (localStorage/matchMedia), and this is
// React's purpose-built API for values that differ between the server
// snapshot and the client snapshot — it doesn't need a synchronous setState
// in a mount effect, and getServerSnapshot's fixed "light" return means
// there's no hydration mismatch to warn about.

import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "jobproof-console-theme";

let currentTheme: Theme = "light";
let initialized = false;
const listeners = new Set<() => void>();

function ensureInitialized() {
  if (initialized || typeof window === "undefined") return;
  const saved = window.localStorage.getItem(STORAGE_KEY);
  currentTheme =
    saved === "light" || saved === "dark"
      ? saved
      : window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
  initialized = true;
}

function subscribe(callback: () => void) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function getSnapshot(): Theme {
  ensureInitialized();
  return currentTheme;
}

function getServerSnapshot(): Theme {
  return "light";
}

function setTheme(theme: Theme) {
  currentTheme = theme;
  window.localStorage.setItem(STORAGE_KEY, theme);
  listeners.forEach((l) => l());
}

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "light",
  toggleTheme: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

export function ThemeProvider({
  children,
}: {
  children: (theme: Theme) => ReactNode;
}) {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const toggleTheme = () => setTheme(theme === "dark" ? "light" : "dark");

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children(theme)}
    </ThemeContext.Provider>
  );
}

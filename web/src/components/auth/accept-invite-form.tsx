"use client";

/*
 * Receiving end of the team invite/reset flow. Supabase's email lands here
 * with session tokens in the URL hash fragment (#access_token=...).
 *
 * This MUST explicitly set the session from those tokens rather than just
 * checking "is any session already present" — if the browser already has
 * an unrelated signed-in session (e.g. an owner testing a teammate's
 * invite link in the same browser), a presence-only check silently reuses
 * that existing session, and the password form below ends up resetting
 * the WRONG account's password. setSession() with the URL's own tokens
 * always overwrites whatever was there, which is the only version of this
 * that's actually safe. (Same bug class mission-control's accept-invite
 * flow hit first — see accept-invite-form.tsx there.)
 */

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type Phase = "checking" | "ready" | "invalid" | "saving";

const inputCls =
  "w-full appearance-none rounded-full border border-cream-border bg-cream-input px-[18px] py-[13px] text-sm text-ink outline-none focus:border-terracotta";

export function AcceptInviteForm() {
  const router = useRouter();
  // supabase is a stable module-level constant (env-determined at build
  // time, same on server and client) — safe to fold into the initial
  // state directly rather than setting it from inside the effect.
  const [phase, setPhase] = useState<Phase>(supabase ? "checking" : "invalid");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;

    const rawHash = window.location.hash.startsWith("#")
      ? window.location.hash.slice(1)
      : window.location.hash;
    const hashParams = new URLSearchParams(rawHash);
    const accessToken = hashParams.get("access_token");
    const refreshToken = hashParams.get("refresh_token");

    if (!accessToken || !refreshToken) {
      // No tokens in this URL at all — not a link we generated, or it was
      // already consumed. Do NOT fall back to "is a session already
      // present", since that's exactly what causes the wrong-account bug.
      // queueMicrotask defers the setState out of the effect's synchronous
      // body (react-hooks/set-state-in-effect) — this reads window.location
      // itself, so unlike the supabase-missing case above, it can't be
      // folded into the initial state.
      queueMicrotask(() => setPhase("invalid"));
      return;
    }

    supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken }).then(
      ({ data, error }) => {
        if (error || !data.session) {
          setPhase("invalid");
          return;
        }
        // Scrub the tokens from the address bar so a refresh/back-nav
        // can't resubmit them, then reveal the set-password form.
        window.history.replaceState(null, "", window.location.pathname);
        setPhase("ready");
      }
    );
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Use at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    if (!supabase) {
      setError("Supabase is not configured.");
      return;
    }

    setPhase("saving");
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setError(error.message);
      setPhase("ready");
      return;
    }
    router.replace("/overview");
    router.refresh();
  }

  return (
    <div className="grid min-h-screen place-items-center bg-cream-page p-5 font-onboarding">
      <div className="w-full max-w-sm">
        <div className="mb-5 flex items-center gap-3">
          <div className="grid size-11 flex-none place-items-center rounded-[14px] bg-[#e8785030]">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--color-terracotta)" strokeWidth="2.2" strokeLinecap="round">
              <path d="M9 3v7l-4.5 8a2 2 0 0 0 1.8 3h11.4a2 2 0 0 0 1.8-3L15 10V3" />
              <path d="M7.5 3h9" />
              <path d="M8 14h8" />
            </svg>
          </div>
          <div>
            <div className="text-[17px] font-semibold tracking-tight text-ink">MedLab AI</div>
            <div className="text-[10px] font-semibold tracking-[0.08em] text-cream-faint uppercase">
              AI Receptionist · Console
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-cream-border bg-cream px-6 pt-7 pb-6 shadow-[0_8px_30px_rgba(120,80,50,0.12)] sm:px-9 sm:pt-9 sm:pb-7">
          {phase === "checking" ? (
            <div className="text-[13.5px] text-cream-muted">Confirming your invite…</div>
          ) : null}

          {phase === "invalid" ? (
            <>
              <h1 className="font-display text-[22px] font-medium text-ink">Invite link invalid</h1>
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-3 text-xs leading-relaxed text-amber-800">
                This link is invalid or has already been used. Ask an owner to
                send a fresh one from Team.
              </div>
            </>
          ) : null}

          {phase === "ready" || phase === "saving" ? (
            <>
              <h1 className="font-display text-[22px] font-medium text-ink">Set your password</h1>
              <p className="mt-1.5 text-[13.5px] text-cream-muted">
                Choose a password to finish joining the console.
              </p>
              <form onSubmit={onSubmit} className="mt-5 flex flex-col gap-3.5">
                <input
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  placeholder="New password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={inputCls}
                />
                <input
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  placeholder="Confirm password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className={inputCls}
                />
                {error ? (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800">
                    {error}
                  </div>
                ) : null}
                <button
                  type="submit"
                  disabled={phase === "saving"}
                  className="rounded-full bg-terracotta py-[15px] text-sm font-semibold text-white shadow-[0_6px_18px_rgba(201,111,74,0.35)] hover:bg-terracotta-dark disabled:opacity-60"
                >
                  {phase === "saving" ? "Saving…" : "Set password & continue"}
                </button>
              </form>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

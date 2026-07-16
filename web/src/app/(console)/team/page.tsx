"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-gate";
import { authHeaders } from "@/lib/auth-headers";

interface Member {
  user_id: string;
  role: string;
  created_at: string;
  email: string;
  invite_pending: boolean;
}

export default function TeamPage() {
  const { user, tenant } = useAuth();

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-[19px] font-bold tracking-tight">Team</h1>
        <p className="mt-0.5 text-[12.5px] text-slate-500 dark:text-slate-400">
          Who has console access to {tenant?.lab_name ?? "this lab"}.
        </p>
      </div>

      {!user || !tenant ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white/60 px-4.5 py-10 text-center text-sm text-slate-400 dark:border-slate-700 dark:bg-slate-900/60">
          Sign in to a provisioned lab account to manage the team.
        </div>
      ) : (
        // Keyed by tenant.id so it refetches cleanly if the caller's tenant
        // ever changes rather than showing stale cross-tenant data.
        <TeamPanel key={tenant.id} />
      )}
    </div>
  );
}

function TeamPanel() {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [callerUserId, setCallerUserId] = useState<string | null>(null);
  const [callerRole, setCallerRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"staff" | "owner">("staff");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [rowBusy, setRowBusy] = useState<string | null>(null);

  async function load() {
    try {
      const res = await fetch("/api/team/members", { headers: await authHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not load team.");
      setMembers(data.members);
      setCallerUserId(data.callerUserId);
      setCallerRole(data.callerRole);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load team.");
    } finally {
      setLoading(false);
    }
  }

  // Inlined as a .then() chain rather than calling load() — the mount
  // effect can't call a named function that (even conditionally) sets
  // state, per react-hooks/set-state-in-effect. load() itself stays
  // async/await for the button handlers below, which aren't affected.
  useEffect(() => {
    let disposed = false;
    authHeaders()
      .then((headers) => fetch("/api/team/members", { headers }))
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (disposed) return;
        if (ok) {
          setMembers(data.members);
          setCallerUserId(data.callerUserId);
          setCallerRole(data.callerRole);
        } else {
          setError(data.error ?? "Could not load team.");
        }
        setLoading(false);
      })
      .catch(() => {
        if (disposed) return;
        setError("Could not load team.");
        setLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, []);

  async function onInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviteBusy(true);
    setInviteError(null);
    try {
      const res = await fetch("/api/team/invite", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not send invite.");
      setInviteEmail("");
      setInviteRole("staff");
      await load();
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setInviteBusy(false);
    }
  }

  async function onRemove(userId: string) {
    setRowBusy(userId);
    try {
      const res = await fetch("/api/team/remove", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ user_id: userId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not remove.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setRowBusy(null);
    }
  }

  async function onRoleChange(userId: string, role: string) {
    setRowBusy(userId);
    try {
      const res = await fetch("/api/team/role", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ user_id: userId, role }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not update role.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setRowBusy(null);
    }
  }

  const isOwner = callerRole === "owner";

  return (
    <div className="max-w-[640px] rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:shadow-none">
      <div className="border-b border-slate-200 px-4.5 py-3 text-xs font-bold text-slate-900 dark:border-slate-700 dark:text-slate-100">
        Members
      </div>

      {error ? (
        <div className="m-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="px-4.5 py-10 text-center text-sm text-slate-400">Loading team…</div>
      ) : (
        members?.map((m) => (
          <div
            key={m.user_id}
            className="flex items-center gap-3 border-b border-slate-100 px-4.5 py-3 last:border-b-0 dark:border-slate-800"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                {m.email}
                {m.user_id === callerUserId ? (
                  <span className="ml-1.5 font-mono text-[10px] font-normal text-slate-400 dark:text-slate-500">
                    (you)
                  </span>
                ) : null}
              </div>
              <div className="mt-0.5 font-mono text-[10.5px] text-slate-400 dark:text-slate-500">
                {m.invite_pending ? "Invite pending" : `Joined ${new Date(m.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`}
              </div>
            </div>

            {isOwner && m.user_id !== callerUserId ? (
              <select
                value={m.role}
                disabled={rowBusy === m.user_id}
                onChange={(e) => void onRoleChange(m.user_id, e.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 outline-none disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
              >
                <option value="staff">Staff</option>
                <option value="owner">Owner</option>
              </select>
            ) : (
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-600 capitalize dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                {m.role}
              </span>
            )}

            {isOwner && m.user_id !== callerUserId ? (
              <button
                onClick={() => void onRemove(m.user_id)}
                disabled={rowBusy === m.user_id}
                className="flex-none text-xs font-semibold text-red-600 hover:text-red-800 disabled:opacity-50 dark:text-red-400 dark:hover:text-red-300"
              >
                Remove
              </button>
            ) : null}
          </div>
        ))
      )}

      {isOwner ? (
        <form onSubmit={onInvite} className="flex flex-wrap items-end gap-2.5 border-t border-slate-200 px-4.5 py-3.5 dark:border-slate-700">
          <label className="flex-1 basis-48 text-xs font-semibold text-slate-600 dark:text-slate-400">
            Invite by email
            <input
              type="email"
              required
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="teammate@lab.com"
              className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:ring-indigo-500/20"
            />
          </label>
          <label className="text-xs font-semibold text-slate-600 dark:text-slate-400">
            Role
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as "staff" | "owner")}
              className="mt-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:ring-indigo-500/20"
            >
              <option value="staff">Staff</option>
              <option value="owner">Owner</option>
            </select>
          </label>
          <button
            type="submit"
            disabled={inviteBusy}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {inviteBusy ? "Sending…" : "Send invite"}
          </button>
          {inviteError ? (
            <div className="w-full rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
              {inviteError}
            </div>
          ) : null}
          <p className="w-full text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">
            Sends a Supabase invite email — delivery depends on the project&apos;s
            configured email provider.
          </p>
        </form>
      ) : null}
    </div>
  );
}

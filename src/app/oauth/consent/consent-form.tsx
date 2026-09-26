"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { authClient } from "@/lib/auth-client";

type ScopeItem = { scope: string; label: string };

/**
 * Allow / Deny for an OAuth authorization. The page URL carries the authorization server's
 * signed query; it is posted back as `oauth_query` so the server can resume the request,
 * and the response names the URL to continue to (the client's redirect URI).
 */
export function ConsentForm({
  clientName,
  user,
  scopes,
  write,
  workspaces,
  redirectHost,
}: {
  clientName: string;
  user: { name: string; email: string };
  scopes: ScopeItem[];
  write: ScopeItem | null;
  workspaces: string[];
  redirectHost: string | null;
}) {
  const [allowWrite, setAllowWrite] = useState(true);
  const [pending, setPending] = useState<"allow" | "deny" | "switch" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(accept: boolean) {
    setPending(accept ? "allow" : "deny");
    setError(null);
    const oauthQuery = window.location.search.slice(1);
    const granted = [...scopes.map((s) => s.scope), ...(write && allowWrite ? [write.scope] : [])];
    const { data, error } = await authClient.$fetch<{ url?: string; redirect_uri?: string }>("/oauth2/consent", {
      method: "POST",
      body: {
        accept,
        oauth_query: oauthQuery,
        // Omitting scope accepts everything that was requested.
        ...(accept && write && !allowWrite ? { scope: granted.join(" ") } : {}),
      },
    });
    const next = data?.url ?? data?.redirect_uri;
    if (error || !next) {
      setPending(null);
      setError(error?.message ?? "Could not complete the request. Go back to the app and try again.");
      return;
    }
    window.location.href = next;
  }

  async function switchAccount() {
    setPending("switch");
    await authClient.signOut();
    window.location.href = `/sign-in${window.location.search}`;
  }

  return (
    <div className="mt-5 space-y-5">
      <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
        <div className="min-w-0 text-sm">
          <div className="truncate font-medium">{user.name || user.email}</div>
          <div className="truncate text-fg-muted">{user.email}</div>
        </div>
        <Button size="sm" variant="ghost" onClick={switchAccount} disabled={pending !== null}>
          Not you?
        </Button>
      </div>

      <div>
        <p className="text-sm font-medium">This will allow {clientName} to:</p>
        <ul className="mt-2 space-y-1.5 text-sm">
          {scopes.map((s) => (
            <li key={s.scope} className="flex gap-2">
              <span aria-hidden className="mt-2 h-1 w-1 shrink-0 rounded-full bg-fg-muted" />
              <span>{s.label}</span>
            </li>
          ))}
          {write && (
            <li>
              <label className="flex cursor-pointer items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-0.5 accent-[var(--accent)]"
                  checked={allowWrite}
                  onChange={(e) => setAllowWrite(e.target.checked)}
                />
                <span>
                  {write.label}
                  <span className="block text-xs text-fg-muted">
                    Uncheck to give read-only access. Every edit is saved to page history first, so you can undo it.
                  </span>
                </span>
              </label>
            </li>
          )}
        </ul>
      </div>

      <p className="text-xs text-fg-muted">
        Access covers every workspace you belong to
        {workspaces.length ? `: ${workspaces.join(", ")}` : ""}. You can disconnect the app at any time in Settings.
      </p>

      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="flex gap-2">
        <Button className="flex-1" onClick={() => decide(false)} disabled={pending !== null}>
          {pending === "deny" ? "Denying…" : "Deny"}
        </Button>
        <Button variant="primary" className="flex-1" onClick={() => decide(true)} disabled={pending !== null}>
          {pending === "allow" ? "Allowing…" : "Allow"}
        </Button>
      </div>
      {redirectHost && (
        <p className="text-center text-xs text-fg-muted">You will be sent back to {redirectHost}.</p>
      )}
    </div>
  );
}

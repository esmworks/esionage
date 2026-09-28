"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { joinFromSwitcherAction } from "@/app/actions/workspaces";
import { useIsOffline } from "@/components/offline/offline-context";
import type { JoinableWorkspace } from "@/server/join-requests";

/**
 * In the workspace switcher: workspaces the person's email domain lets them join ("Join") or ask
 * to join ("Request to join"), and the ones they asked already ("Requested").
 */
export function JoinableWorkspaces({ workspaces, onJoined }: { workspaces: JoinableWorkspace[]; onJoined: () => void }) {
  const t = useTranslations("sidebar.joinable");
  const tc = useTranslations("common");
  const router = useRouter();
  const offline = useIsOffline();
  const [pending, startTransition] = useTransition();
  // What happened to each workspace here, until the page reloads with fresh data.
  const [asked, setAsked] = useState<Record<string, true>>({});
  const [error, setError] = useState<string | null>(null);

  const act = (id: string) =>
    startTransition(async () => {
      setError(null);
      try {
        const result = await joinFromSwitcherAction(id);
        if (!result.ok) return setError(result.error);
        if (result.data === "joined") {
          onJoined();
          router.push(`/w/${id}`);
          router.refresh();
          return;
        }
        setAsked((a) => ({ ...a, [id]: true }));
      } catch {
        setError(tc("genericError"));
      }
    });

  return (
    <div className="mt-1 border-t border-border pt-1">
      <div className="px-2 pt-1 pb-0.5 text-xs text-fg-muted">{t("heading")}</div>
      {workspaces.map((w) => {
        const waiting = w.access === "pending" || asked[w.id];
        return (
          <div key={w.id} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm">
            <span className="min-w-0 flex-1 truncate">{w.name}</span>
            {waiting ? (
              <span className="shrink-0 text-xs text-fg-muted">{t("requested")}</span>
            ) : (
              <button
                type="button"
                disabled={pending || offline}
                onClick={() => act(w.id)}
                className="shrink-0 rounded-md border border-border px-2 py-0.5 text-xs hover:bg-bg-hover disabled:opacity-50"
              >
                {w.access === "join" ? t("join") : t("request")}
              </button>
            )}
          </div>
        );
      })}
      {error && <p className="px-2 pb-1 text-xs text-danger">{error}</p>}
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { joinWithLinkAction } from "@/app/actions/workspaces";
import { Button } from "@/components/ui";

/**
 * The join link's button: joins the workspace, or, when the workspace wants an owner to approve
 * people who come through the link (`asks`), sends the request and says so.
 */
export function JoinWorkspace({ token, title, body, asks = false }: { token: string; title: string; body: string; asks?: boolean }) {
  const router = useRouter();
  const t = useTranslations("join");
  const tc = useTranslations("common");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [requested, setRequested] = useState(false);

  if (requested) {
    return (
      <div className="space-y-4">
        <h1 className="text-base font-semibold">{t("requestedTitle")}</h1>
        <p className="text-sm text-fg-muted">{t("requestedBody")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-base font-semibold">{title}</h1>
      <p className="text-sm text-fg-muted">{body}</p>
      {error && <p className="text-sm text-danger">{error}</p>}
      <Button
        variant="primary"
        className="w-full"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            try {
              const result = await joinWithLinkAction(token);
              if (!result.ok) return setError(result.error);
              if (result.data.status !== "joined") return setRequested(true);
              router.push(`/w/${result.data.workspaceId}`);
              router.refresh();
            } catch {
              setError(tc("genericError"));
            }
          })
        }
      >
        {pending ? (asks ? t("requesting") : t("joining")) : asks ? t("request") : t("join")}
      </Button>
    </div>
  );
}

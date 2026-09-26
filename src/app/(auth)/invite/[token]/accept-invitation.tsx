"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { acceptInvitationAction } from "@/app/actions/workspaces";
import { Button } from "@/components/ui";

export function AcceptInvitation({ token, title, body }: { token: string; title: string; body: string }) {
  const router = useRouter();
  const t = useTranslations("invite");
  const tc = useTranslations("common");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

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
              const result = await acceptInvitationAction(token);
              if (!result.ok) return setError(result.error);
              router.push(`/w/${result.data}`);
              router.refresh();
            } catch {
              setError(tc("genericError"));
            }
          })
        }
      >
        {pending ? t("joining") : t("join")}
      </Button>
    </div>
  );
}

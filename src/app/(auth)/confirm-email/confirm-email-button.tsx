"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { confirmEmailChangeAction } from "@/app/actions/account";
import { Button } from "@/components/ui";

export function ConfirmEmailButton({ token }: { token: string }) {
  const t = useTranslations("account.confirmEmail");
  const tc = useTranslations("common");
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (done) {
    return (
      <div className="space-y-3">
        <p className="text-sm">{t("done", { email: done })}</p>
        <Link href="/account?tab=profile" className="text-sm text-accent hover:underline">
          {t("toAccount")}
        </Link>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <Button
        variant="primary"
        className="w-full"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await confirmEmailChangeAction(token).catch(() => null);
            if (!result?.ok) return setError(result?.error ?? tc("genericError"));
            setDone(result.data.email);
          })
        }
      >
        {t("confirm")}
      </Button>
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}

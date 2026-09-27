"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { cancelEmailChangeAction, requestEmailChangeAction } from "@/app/actions/account";
import { SettingsRow } from "@/components/settings/section";
import { Button, Dialog, Input } from "@/components/ui";
import { EMAIL_CHANGE_HOURS } from "@/lib/account";
import { canProve, ProofFields, proofFrom, type ProofSetup } from "./proof-fields";

/**
 * Account > Profile > Email: changing the address goes through a link sent to the new one, so it
 * needs email to be set up on the server; without it the row says so instead.
 */
export function AccountEmailSettings({
  email,
  pendingEmail,
  enabled,
  proof,
}: {
  email: string;
  pendingEmail: string | null;
  enabled: boolean;
  proof: ProofSetup;
}) {
  const t = useTranslations("account.email");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <SettingsRow
        title={email}
        description={enabled ? t("description") : t("mailOff")}
        control={
          <Button disabled={!enabled} onClick={() => setOpen(true)}>
            {t("change")}
          </Button>
        }
      />
      {pendingEmail && (
        <SettingsRow
          title={t("pendingTitle", { email: pendingEmail })}
          description={t("pendingDescription", { hours: EMAIL_CHANGE_HOURS })}
          control={
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => startTransition(() => cancelEmailChangeAction())}
            >
              {tc("cancel")}
            </Button>
          }
        />
      )}
      {open && <ChangeEmailDialog current={email} proof={proof} onClose={() => setOpen(false)} />}
    </>
  );
}

function ChangeEmailDialog({ current, proof, onClose }: { current: string; proof: ProofSetup; onClose: () => void }) {
  const t = useTranslations("account.email");
  const tc = useTranslations("common");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <Dialog open onClose={onClose} className="max-w-md">
      {sentTo ? (
        <div className="space-y-4 p-5">
          <h2 className="text-base font-semibold">{t("sentTitle")}</h2>
          <p className="text-sm text-fg-muted">{t("sentBody", { email: sentTo, hours: EMAIL_CHANGE_HOURS })}</p>
          <div className="flex justify-end">
            <Button variant="primary" onClick={onClose}>
              {tc("close")}
            </Button>
          </div>
        </div>
      ) : (
        <form
          className="space-y-4 p-5"
          onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            setError(null);
            startTransition(async () => {
              const result = await requestEmailChangeAction({
                newEmail: String(form.get("email") ?? ""),
                proof: proofFrom(form),
              }).catch(() => null);
              if (!result?.ok) return setError(result?.error ?? tc("genericError"));
              setSentTo(result.data.email);
            });
          }}
        >
          <h2 className="text-base font-semibold">{t("dialogTitle")}</h2>
          <p className="text-sm text-fg-muted">{t("dialogBody", { email: current })}</p>
          <label className="block space-y-1.5">
            <span className="text-sm text-fg-muted">{t("newLabel")}</span>
            <Input name="email" type="email" required autoComplete="email" autoFocus maxLength={254} />
          </label>
          <ProofFields proof={proof} returnTo="/account?tab=profile" />
          {error && <p className="text-sm text-danger">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              {tc("cancel")}
            </Button>
            <Button type="submit" variant="primary" disabled={pending || !canProve(proof)}>
              {t("send")}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

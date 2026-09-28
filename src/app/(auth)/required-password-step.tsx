"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { finishRequiredPasswordResetAction } from "@/app/actions/account";
import { Button, Input } from "@/components/ui";

/** The refused sign-in's answer when the server can't email a reset link (see server/required-password.ts). */
export type RequiredPassword = { token: string; twoFactor: boolean };

/**
 * After the right old password, when an instance admin asked this account for a new one and the
 * server has no email: choose it here, with a two-step code (or recovery code) when the account
 * has two-step verification. `onChanged` then signs in with the new password as usual.
 */
export function RequiredPasswordStep({
  step,
  onChanged,
  onRestart,
}: {
  step: RequiredPassword;
  onChanged: (newPassword: string) => Promise<void>;
  onRestart: () => void;
}) {
  const t = useTranslations("auth");
  const tc = useTranslations("common");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    const newPassword = String(form.get("password"));
    if (newPassword !== String(form.get("confirm"))) return setError(t("errors.passwordMismatch"));
    setPending(true);
    try {
      const result = await finishRequiredPasswordResetAction({
        token: step.token,
        newPassword,
        code: step.twoFactor ? String(form.get("code") ?? "").trim() : undefined,
      });
      if (!result.ok) {
        if (result.code === "resetStepExpired") setExpired(true);
        return setError(result.error);
      }
      await onChanged(newPassword);
    } catch {
      setError(tc("genericError"));
    } finally {
      setPending(false);
    }
  }

  if (expired) {
    return (
      <div className="space-y-4">
        <h1 className="text-base font-semibold">{t("requiredPassword.title")}</h1>
        {error && <p className="text-sm text-danger">{error}</p>}
        <Button variant="primary" className="w-full" onClick={onRestart}>
          {t("twoFactor.restart")}
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <h1 className="text-base font-semibold">{t("requiredPassword.title")}</h1>
        <p className="text-sm text-fg-muted">{t("requiredPassword.intro")}</p>
      </div>
      <label className="block space-y-1.5">
        <span className="text-sm text-fg-muted">{t("fields.newPassword")}</span>
        <Input name="password" type="password" required minLength={8} autoComplete="new-password" autoFocus />
      </label>
      <label className="block space-y-1.5">
        <span className="text-sm text-fg-muted">{t("fields.confirmPassword")}</span>
        <Input name="confirm" type="password" required minLength={8} autoComplete="new-password" />
      </label>
      {step.twoFactor && (
        <label className="block space-y-1.5">
          <span className="text-sm text-fg-muted">{t("requiredPassword.codeLabel")}</span>
          <Input name="code" required autoComplete="one-time-code" spellCheck={false} />
        </label>
      )}
      {error && <p className="text-sm text-danger">{error}</p>}
      <Button type="submit" variant="primary" className="w-full" disabled={pending}>
        {pending ? t("pending") : t("requiredPassword.submit")}
      </Button>
      <p className="text-center text-sm">
        <button type="button" className="text-fg-muted hover:text-fg hover:underline" onClick={onRestart}>
          {t("twoFactor.back")}
        </button>
      </p>
    </form>
  );
}

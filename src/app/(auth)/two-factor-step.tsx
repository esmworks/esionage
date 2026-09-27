"use client";

import { KeyRound } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { usePasskeySupport } from "@/components/security/passkeys";
import { CodeInput, useSecurityError } from "@/components/security/two-factor";
import { Button } from "@/components/ui";
import { authClient } from "@/lib/auth-client";
import { securityErrorKey } from "@/lib/auth-errors";

/** A sign-in response that may carry the URL of an OAuth authorization to continue. */
type SignedIn = { url?: string } | null | undefined;

/**
 * Second step of signing in with two-step verification on: a code from the authenticator app,
 * or a recovery code. The pending sign-in lives in a short-lived cookie the server set on the
 * first step (password, or a social provider's callback).
 */
export function TwoFactorStep({ onSignedIn, onRestart }: { onSignedIn: (data: SignedIn) => void; onRestart: () => void }) {
  const t = useTranslations("auth.twoFactor");
  const describe = useSecurityError();
  const [recovery, setRecovery] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const code = String(form.get("code") ?? "").replace(/\s+/g, "");
    const trustDevice = form.get("trust") === "on";
    const result = recovery
      ? await authClient.twoFactor.verifyBackupCode({ code, trustDevice })
      : await authClient.twoFactor.verifyTotp({ code, trustDevice });
    setPending(false);
    if (result.error) {
      const key = securityErrorKey(result.error);
      // The pending sign-in is gone (expired, or too many wrong codes): start over.
      if (key === "challengeExpired" || key === "tooManyCodes") setExpired(true);
      return setError(describe(result.error));
    }
    onSignedIn(result.data as SignedIn);
  }

  if (expired) {
    return (
      <div className="space-y-4">
        <h1 className="text-base font-semibold">{t("title")}</h1>
        {error && <p className="text-sm text-danger">{error}</p>}
        <Button variant="primary" className="w-full" onClick={onRestart}>
          {t("restart")}
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <h1 className="text-base font-semibold">{t("title")}</h1>
      <p className="text-sm text-fg-muted">{recovery ? t("recoveryIntro") : t("intro")}</p>
      <label htmlFor="two-factor-code" className="block space-y-1.5">
        <span className="text-sm text-fg-muted">{recovery ? t("recoveryLabel") : t("codeLabel")}</span>
        <CodeInput key={recovery ? "recovery" : "totp"} id="two-factor-code" recovery={recovery} autoFocus />
      </label>
      <label className="flex cursor-pointer items-center gap-2 text-sm text-fg-muted">
        <input type="checkbox" name="trust" className="accent-[var(--accent)]" />
        {t("trustDevice")}
      </label>
      {error && <p className="text-sm text-danger">{error}</p>}
      <Button type="submit" variant="primary" className="w-full" disabled={pending}>
        {pending ? t("pending") : t("submit")}
      </Button>
      <div className="flex flex-wrap justify-between gap-2 text-sm">
        <button
          type="button"
          className="text-accent hover:underline"
          onClick={() => {
            setRecovery(!recovery);
            setError(null);
          }}
        >
          {recovery ? t("useApp") : t("useRecovery")}
        </button>
        <button type="button" className="text-fg-muted hover:text-fg hover:underline" onClick={onRestart}>
          {t("back")}
        </button>
      </div>
    </form>
  );
}

/** "Sign in with a passkey": the browser offers the passkeys saved for this site. */
export function PasskeySignIn({ onSignedIn, onError }: { onSignedIn: (data: SignedIn) => void; onError: (message: string | null) => void }) {
  const t = useTranslations("auth.passkey");
  const describe = useSecurityError();
  const supported = usePasskeySupport();
  const [pending, setPending] = useState(false);
  if (!supported) return null;
  return (
    <Button
      className="w-full gap-2"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        onError(null);
        const result = await authClient.signIn.passkey();
        setPending(false);
        if (result?.error) return onError(describe(result.error));
        onSignedIn(result?.data as SignedIn);
      }}
    >
      <KeyRound className="h-4 w-4" aria-hidden />
      {pending ? t("pending") : t("signIn")}
    </Button>
  );
}

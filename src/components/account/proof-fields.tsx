"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { CodeInput } from "@/components/security/two-factor";
import { Button, Input } from "@/components/ui";
import type { Proof, ProofKind } from "@/lib/account";
import { authClient } from "@/lib/auth-client";
import { wipeAllOfflineData } from "@/components/offline/offline-store";

/** How this account confirms sensitive changes, and whether its session is recent enough for the last resort. */
export type ProofSetup = { kind: ProofKind; recent: boolean };

/** The proof fields of a form, read back from its FormData. */
export function proofFrom(form: FormData): Proof {
  const password = form.get("current-password");
  const code = form.get("code");
  return {
    ...(typeof password === "string" ? { password } : {}),
    ...(typeof code === "string" ? { code: code.trim() } : {}),
  };
}

/**
 * What a sensitive change asks for: the current password; for accounts without one, a code from
 * the authenticator app or a recovery code; and for accounts with neither, a recent sign-in (with
 * a way to sign in again when it's been too long).
 */
export function ProofFields({ proof, returnTo }: { proof: ProofSetup; returnTo: string }) {
  const t = useTranslations("account.proof");
  if (proof.kind === "password") {
    return (
      <label className="block space-y-1.5">
        <span className="text-sm text-fg-muted">{t("password")}</span>
        <Input name="current-password" type="password" required autoComplete="current-password" />
      </label>
    );
  }
  if (proof.kind === "code") {
    return (
      <label htmlFor="proof-code" className="block space-y-1.5">
        <span className="text-sm text-fg-muted">{t("code")}</span>
        <CodeInput id="proof-code" recovery />
      </label>
    );
  }
  if (proof.recent) return <p className="text-sm text-fg-muted">{t("recent")}</p>;
  return <SignInAgain returnTo={returnTo} />;
}

/** Signing out and back in, for accounts that can only prove themselves with a fresh sign-in. */
export function SignInAgain({ returnTo }: { returnTo: string }) {
  const t = useTranslations("account.proof");
  const [pending, setPending] = useState(false);
  return (
    <div className="space-y-2 rounded-lg border border-border bg-bg-subtle px-3 py-2.5 text-sm">
      <p className="text-fg-muted">{t("stale")}</p>
      <Button
        size="sm"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          await authClient.signOut();
          await wipeAllOfflineData();
          window.location.href = `/sign-in?next=${encodeURIComponent(returnTo)}`;
        }}
      >
        {t("signInAgain")}
      </Button>
    </div>
  );
}

/** Whether the form can be sent: accounts proving themselves by a recent sign-in need one. */
export const canProve = (proof: ProofSetup) => proof.kind !== "recentSignIn" || proof.recent;

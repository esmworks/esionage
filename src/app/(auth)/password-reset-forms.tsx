"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button, Input } from "@/components/ui";
import { authClient } from "@/lib/auth-client";

/** A title, a short explanation and one link; the end state of each step. */
export function AuthNotice({ title, body, link }: { title: string; body: string; link: { href: string; label: string } }) {
  return (
    <div className="space-y-4">
      <h1 className="text-base font-semibold">{title}</h1>
      <p className="text-sm text-fg-muted">{body}</p>
      <p className="text-center text-sm">
        <Link href={link.href} className="text-accent hover:underline">
          {link.label}
        </Link>
      </p>
    </div>
  );
}

type AuthError = { status: number; code?: string } | null;

export function ForgotPasswordForm({ minutes }: { minutes: number }) {
  const t = useTranslations("auth");
  const tc = useTranslations("common");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const email = String(new FormData(e.currentTarget).get("email"));
    const { error: failure } = (await authClient.requestPasswordReset({ email, redirectTo: "/reset-password" })) as {
      error: AuthError;
    };
    setPending(false);
    if (!failure) setSentTo(email);
    else if (failure.code === "RESET_PASSWORD_DISABLED") setUnavailable(true);
    else if (failure.status === 429) setError(t("errors.tooManyAttempts"));
    else if (failure.code === "INVALID_EMAIL" || failure.code === "VALIDATION_ERROR") setError(t("errors.invalidEmail"));
    else setError(tc("genericError"));
  }

  const back = { href: "/sign-in", label: t("forgotPassword.backToSignIn") };
  if (unavailable) {
    return <AuthNotice title={t("forgotPassword.unavailableTitle")} body={t("forgotPassword.unavailableBody")} link={back} />;
  }
  if (sentTo) {
    return (
      <AuthNotice
        title={t("forgotPassword.sentTitle")}
        body={t("forgotPassword.sentBody", { email: sentTo, minutes })}
        link={back}
      />
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <h1 className="text-base font-semibold">{t("forgotPassword.title")}</h1>
        <p className="text-sm text-fg-muted">{t("forgotPassword.intro")}</p>
      </div>
      <label className="block space-y-1.5">
        <span className="text-sm text-fg-muted">{t("fields.email")}</span>
        <Input name="email" type="email" required autoComplete="email" autoFocus />
      </label>
      {error && <p className="text-sm text-danger">{error}</p>}
      <Button type="submit" variant="primary" className="w-full" disabled={pending}>
        {pending ? t("pending") : t("forgotPassword.submit")}
      </Button>
      <p className="text-center text-sm">
        <Link href={back.href} className="text-accent hover:underline">
          {back.label}
        </Link>
      </p>
    </form>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const t = useTranslations("auth");
  const tc = useTranslations("common");
  const [state, setState] = useState<"form" | "done" | "invalid">("form");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    const newPassword = String(form.get("password"));
    if (newPassword !== String(form.get("confirm"))) {
      setError(t("errors.passwordMismatch"));
      return;
    }
    setPending(true);
    const { error: failure } = (await authClient.resetPassword({ newPassword, token })) as { error: AuthError };
    setPending(false);
    if (!failure) setState("done");
    else if (failure.code === "INVALID_TOKEN") setState("invalid");
    else if (failure.code === "PASSWORD_TOO_SHORT") setError(t("errors.passwordTooShort"));
    else if (failure.code === "PASSWORD_TOO_LONG") setError(t("errors.passwordTooLong"));
    // An instance admin asked for a new password; the old one doesn't count (server/required-password.ts).
    else if (failure.code === "PASSWORD_UNCHANGED") setError(t("errors.passwordUnchanged"));
    else if (failure.status === 429) setError(t("errors.tooManyAttempts"));
    else setError(tc("genericError"));
  }

  if (state === "done") {
    return (
      <AuthNotice
        title={t("resetPassword.doneTitle")}
        body={t("resetPassword.doneBody")}
        link={{ href: "/sign-in", label: t("resetPassword.signIn") }}
      />
    );
  }
  if (state === "invalid") return <InvalidResetLink />;

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <h1 className="text-base font-semibold">{t("resetPassword.title")}</h1>
      <label className="block space-y-1.5">
        <span className="text-sm text-fg-muted">{t("fields.newPassword")}</span>
        <Input name="password" type="password" required minLength={8} autoComplete="new-password" autoFocus />
      </label>
      <label className="block space-y-1.5">
        <span className="text-sm text-fg-muted">{t("fields.confirmPassword")}</span>
        <Input name="confirm" type="password" required minLength={8} autoComplete="new-password" />
      </label>
      {error && <p className="text-sm text-danger">{error}</p>}
      <Button type="submit" variant="primary" className="w-full" disabled={pending}>
        {pending ? t("pending") : t("resetPassword.submit")}
      </Button>
    </form>
  );
}

export function InvalidResetLink() {
  const t = useTranslations("auth");
  return (
    <AuthNotice
      title={t("resetPassword.invalidTitle")}
      body={t("errors.invalidToken")}
      link={{ href: "/forgot-password", label: t("resetPassword.requestNew") }}
    />
  );
}

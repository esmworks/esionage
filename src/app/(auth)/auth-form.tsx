"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Button, Input } from "@/components/ui";
import { usePasskeySupport } from "@/components/security/passkeys";
import { authClient } from "@/lib/auth-client";
import type { SocialProvider } from "@/lib/social-providers";
import { SocialSignIn, socialErrorKey } from "./social-sign-in";
import { SsoSignIn, type SsoOptions } from "./sso-sign-in";
import { AuthNotice } from "./password-reset-forms";
import { RequiredPasswordStep, type RequiredPassword } from "./required-password-step";
import { PasskeySignIn, TwoFactorStep } from "./two-factor-step";

type Mode = "sign-in" | "sign-up";

/** better-auth error codes we have our own wording for; anything else gets the generic message. */
const ERROR_KEYS = {
  INVALID_EMAIL_OR_PASSWORD: "invalidCredentials",
  USER_ALREADY_EXISTS: "emailTaken",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "emailTaken",
  PASSWORD_TOO_SHORT: "passwordTooShort",
  PASSWORD_TOO_LONG: "passwordTooLong",
  INVALID_EMAIL: "invalidEmail",
  EMAIL_PASSWORD_SIGN_UP_DISABLED: "signUpDisabled",
} as const;

/**
 * Shared sign-in / sign-up form. When reached from an OAuth authorization (MCP client
 * connecting), the page URL carries the signed authorization query; the oauth-provider
 * client plugin forwards it and the server answers with the URL to continue to.
 */
export function AuthForm({
  mode,
  signUpEnabled = true,
  invite,
  join,
  next = "/",
  title,
  socialProviders = [],
  initialStep = "credentials",
  sso,
}: {
  mode: Mode;
  signUpEnabled?: boolean;
  /** Sign-up from an invitation link: the email is fixed and the link token admits it. */
  invite?: { token: string; email: string };
  /** Sign-up from a workspace's join link: the new account joins that workspace. */
  join?: string;
  /** Same-origin path to open afterwards. */
  next?: string;
  title?: string;
  /** Providers the server has credentials for; empty hides the buttons. */
  socialProviders?: SocialProvider[];
  /** "two-factor" when a social sign-in came back needing a code (`?step=two-factor`). */
  initialStep?: "credentials" | "two-factor";
  /** Single sign-on on the sign-in page (instance provider, "Continue with SSO"). */
  sso?: SsoOptions;
}) {
  const router = useRouter();
  const t = useTranslations("auth");
  const tc = useTranslations("common");
  const text = mode === "sign-in" ? "signIn" : "signUp";
  const linkPath = invite ? `/invite/${invite.token}` : join ? `/join/${join}` : null;
  const switchHref = linkPath ? `/sign-in?next=${encodeURIComponent(linkPath)}` : null;
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [search, setSearch] = useState("");
  const [step, setStep] = useState<"credentials" | "two-factor" | "new-password" | "reset-emailed">(
    mode === "sign-in" ? initialStep : "credentials",
  );
  // An instance admin asked for a new password (see server/required-password.ts).
  const [required, setRequired] = useState<{ email: string } & Partial<RequiredPassword>>({ email: "" });
  const passkeySupported = usePasskeySupport();
  const showPasskey = mode === "sign-in" && passkeySupported === true;
  const showSso = mode === "sign-in" && !invite && !join && !!sso && (sso.byEmail || !!sso.instanceName);
  useEffect(() => {
    // A social sign-in that failed comes back here with `?error=`.
    const params = new URLSearchParams(window.location.search);
    const code = params.get("error");
    if (!code) return setSearch(window.location.search);
    // Single sign-on reports some errors as phrases ("account not linked").
    setError(t(`errors.${socialErrorKey(code.trim().toLowerCase().replace(/\s+/g, "_"))}`));
    params.delete("error");
    params.delete("error_description");
    setSearch(params.size ? `?${params}` : "");
  }, [t]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const form = new FormData(e.currentTarget);
    const email = invite?.email ?? String(form.get("email"));
    const password = String(form.get("password"));
    const result =
      mode === "sign-in"
        ? await authClient.signIn.email({ email, password })
        : await authClient.signUp.email({
            email,
            password,
            name: String(form.get("name")),
            fetchOptions: invite
              ? { query: { invite: invite.token } }
              : join
                ? { query: { join } }
                : undefined,
          });
    setPending(false);
    if (result.error?.code === "PASSWORD_RESET_REQUIRED") {
      const answer = result.error as { delivery?: string; resetToken?: string; twoFactor?: boolean };
      if (answer.delivery === "in-app" && answer.resetToken) {
        setRequired({ email, token: answer.resetToken, twoFactor: answer.twoFactor === true });
        return setStep("new-password");
      }
      setRequired({ email });
      return setStep("reset-emailed");
    }
    if (result.error) {
      const code = result.error.code as keyof typeof ERROR_KEYS | undefined;
      if (result.error.status === 429) setError(t("errors.tooManyAttempts"));
      else if (code && code in ERROR_KEYS) setError(t(`errors.${ERROR_KEYS[code]}`));
      else setError(tc("genericError"));
      return;
    }
    const data = result.data as { url?: string; redirect?: boolean; twoFactorRedirect?: boolean } | null;
    // Two-step verification is on: the password was right, now the code (same page, so an OAuth
    // authorization in the URL carries on once the code is in).
    if (data?.twoFactorRedirect) return setStep("two-factor");
    signedIn(data);
  }

  /** Continue an OAuth authorization the server handed back, or open `next`. */
  function signedIn(data: { url?: string } | null | undefined) {
    if (data?.url) {
      window.location.href = data.url;
      return;
    }
    router.push(next);
    router.refresh();
  }

  function restart() {
    setError(null);
    setStep("credentials");
  }

  if (step === "new-password" && required.token) {
    return (
      <RequiredPasswordStep
        step={{ token: required.token, twoFactor: required.twoFactor === true }}
        onRestart={restart}
        onChanged={async (password) => {
          // Signing in with the new password asks for the two-step code again, as any sign-in does.
          const result = await authClient.signIn.email({ email: required.email, password });
          if (result.error) return restart();
          const data = result.data as { url?: string; twoFactorRedirect?: boolean } | null;
          if (data?.twoFactorRedirect) return setStep("two-factor");
          signedIn(data);
        }}
      />
    );
  }

  if (step === "reset-emailed") {
    return (
      <AuthNotice
        title={t("requiredPassword.title")}
        body={t("requiredPassword.emailed", { email: required.email })}
        link={{ href: "/sign-in", label: t("forgotPassword.backToSignIn") }}
      />
    );
  }

  if (step === "two-factor") {
    return (
      <TwoFactorStep
        onSignedIn={signedIn}
        onRestart={() => {
          setError(null);
          setStep("credentials");
          // Drop `?step=two-factor` so a reload shows the password form.
          const params = new URLSearchParams(window.location.search);
          if (params.has("step")) {
            params.delete("step");
            window.history.replaceState(null, "", `${window.location.pathname}${params.size ? `?${params}` : ""}`);
          }
        }}
      />
    );
  }

  if (mode === "sign-up" && !signUpEnabled && !invite) {
    return (
      <div className="space-y-4">
        <h1 className="text-base font-semibold">{t("signUp.disabledTitle")}</h1>
        <p className="text-sm text-fg-muted">{t("signUp.disabledBody")}</p>
        <p className="text-center text-sm">
          <Link href={`/sign-in${search}`} className="text-accent hover:underline">
            {t("signUp.switchLink")}
          </Link>
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <h1 className="text-base font-semibold">{title ?? t(`${text}.title`)}</h1>
      {mode === "sign-up" && (
        <label className="block space-y-1.5">
          <span className="text-sm text-fg-muted">{t("fields.name")}</span>
          <Input name="name" required autoComplete="name" />
        </label>
      )}
      <label className="block space-y-1.5">
        <span className="text-sm text-fg-muted">{t("fields.email")}</span>
        {invite ? (
          <Input name="email" type="email" value={invite.email} readOnly aria-readonly />
        ) : (
          <Input name="email" type="email" required autoComplete="email" />
        )}
      </label>
      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <label htmlFor="password" className="text-sm text-fg-muted">
            {t("fields.password")}
          </label>
          {mode === "sign-in" && (
            <Link href="/forgot-password" className="text-xs text-accent hover:underline">
              {t("signIn.forgotLink")}
            </Link>
          )}
        </div>
        <Input
          id="password"
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
        />
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      <Button type="submit" variant="primary" className="w-full" disabled={pending}>
        {pending ? t("pending") : t(`${text}.submit`)}
      </Button>
      {(showPasskey || socialProviders.length > 0 || showSso) && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 text-xs text-fg-muted">
            <span className="h-px flex-1 bg-border" />
            {t("social.or")}
            <span className="h-px flex-1 bg-border" />
          </div>
          <div className="space-y-2">
            {showPasskey && <PasskeySignIn onSignedIn={signedIn} onError={setError} />}
            {socialProviders.length > 0 && (
              <SocialSignIn
                providers={socialProviders}
                // From an invitation or join link, an existing account comes back to accept it
                // there; a new one has already joined (see the user-create hook in auth.ts).
                callbackURL={linkPath ?? next}
                newUserCallbackURL={linkPath ? next : undefined}
                query={invite ? { invite: invite.token } : join ? { join } : undefined}
                onError={setError}
              />
            )}
            {showSso && sso && <SsoSignIn options={sso} callbackURL={next} onError={setError} />}
          </div>
        </div>
      )}
      {(mode === "sign-up" || signUpEnabled) && (
        <p className="text-center text-sm text-fg-muted">
          {t(`${text}.switchPrompt`)}{" "}
          {/* Keep the OAuth query so a new user can finish connecting an app. */}
          <Link
            href={switchHref ?? `/${mode === "sign-in" ? "sign-up" : "sign-in"}${search}`}
            className="text-accent hover:underline"
          >
            {t(`${text}.switchLink`)}
          </Link>
        </p>
      )}
    </form>
  );
}

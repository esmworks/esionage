"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Button, Input } from "@/components/ui";
import { authClient } from "@/lib/auth-client";

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
export function AuthForm({ mode, signUpEnabled = true }: { mode: Mode; signUpEnabled?: boolean }) {
  const router = useRouter();
  const t = useTranslations("auth");
  const tc = useTranslations("common");
  const text = mode === "sign-in" ? "signIn" : "signUp";
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [search, setSearch] = useState("");
  useEffect(() => setSearch(window.location.search), []);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email"));
    const password = String(form.get("password"));
    const result =
      mode === "sign-in"
        ? await authClient.signIn.email({ email, password })
        : await authClient.signUp.email({ email, password, name: String(form.get("name")) });
    setPending(false);
    if (result.error) {
      const code = result.error.code as keyof typeof ERROR_KEYS | undefined;
      if (result.error.status === 429) setError(t("errors.tooManyAttempts"));
      else if (code && code in ERROR_KEYS) setError(t(`errors.${ERROR_KEYS[code]}`));
      else setError(tc("genericError"));
      return;
    }
    const data = result.data as { url?: string; redirect?: boolean } | null;
    if (data?.url) {
      window.location.href = data.url;
      return;
    }
    router.push("/");
    router.refresh();
  }

  if (mode === "sign-up" && !signUpEnabled) {
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
      <h1 className="text-base font-semibold">{t(`${text}.title`)}</h1>
      {mode === "sign-up" && (
        <label className="block space-y-1.5">
          <span className="text-sm text-fg-muted">{t("fields.name")}</span>
          <Input name="name" required autoComplete="name" />
        </label>
      )}
      <label className="block space-y-1.5">
        <span className="text-sm text-fg-muted">{t("fields.email")}</span>
        <Input name="email" type="email" required autoComplete="email" />
      </label>
      <label className="block space-y-1.5">
        <span className="text-sm text-fg-muted">{t("fields.password")}</span>
        <Input
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
        />
      </label>
      {error && <p className="text-sm text-danger">{error}</p>}
      <Button type="submit" variant="primary" className="w-full" disabled={pending}>
        {pending ? t("pending") : t(`${text}.submit`)}
      </Button>
      {(mode === "sign-up" || signUpEnabled) && (
        <p className="text-center text-sm text-fg-muted">
          {t(`${text}.switchPrompt`)}{" "}
          {/* Keep the OAuth query so a new user can finish connecting an app. */}
          <Link href={`/${mode === "sign-in" ? "sign-up" : "sign-in"}${search}`} className="text-accent hover:underline">
            {t(`${text}.switchLink`)}
          </Link>
        </p>
      )}
    </form>
  );
}

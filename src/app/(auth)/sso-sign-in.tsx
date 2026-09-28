"use client";

import { Building2, KeyRound } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button, Input } from "@/components/ui";
import { authClient } from "@/lib/auth-client";
import { INSTANCE_SSO_PROVIDER_ID } from "@/lib/sso-config";

/** What the sign-in page offers for single sign-on (see the sign-in page). */
export type SsoOptions = {
  /** The instance provider's button label, when OIDC_ISSUER is set. */
  instanceName: string | null;
  /** "Continue with SSO": typing an email picks the provider (instance domains, verified workspaces). */
  byEmail: boolean;
};

/** Where a failed single sign-on comes back to: this page, without an earlier error. */
function errorCallbackURL() {
  const here = new URL(window.location.href);
  here.searchParams.delete("error");
  here.searchParams.delete("error_description");
  return here.pathname + here.search;
}

/**
 * Starts a single sign-on. `providerId` for the instance provider's button (or a workspace's gate),
 * `email` for "Continue with SSO", where the server picks the provider from the address.
 */
export async function startSso(input: { providerId?: string; email?: string; callbackURL: string }) {
  return authClient.signIn.sso({
    ...(input.providerId ? { providerId: input.providerId } : { email: input.email ?? "" }),
    callbackURL: input.callbackURL,
    errorCallbackURL: errorCallbackURL(),
  });
}

/**
 * The sign-in page's single sign-on: the instance provider's button, and "Continue with SSO", which
 * asks for the work email and continues at that organization's identity provider.
 */
export function SsoSignIn({
  options,
  callbackURL,
  onError,
}: {
  options: SsoOptions;
  callbackURL: string;
  onError: (message: string | null) => void;
}) {
  const t = useTranslations("auth");
  const tc = useTranslations("common");
  const [pending, setPending] = useState<"instance" | "email" | null>(null);
  const [asking, setAsking] = useState(false);

  async function start(kind: "instance" | "email", email?: string) {
    onError(null);
    setPending(kind);
    const result = await startSso(
      kind === "instance" ? { providerId: INSTANCE_SSO_PROVIDER_ID, callbackURL } : { email, callbackURL },
    );
    // On success the browser is already on its way to the identity provider.
    if (result.error) {
      setPending(null);
      const code = (result.error as { code?: string }).code;
      if (result.error.status === 429) onError(t("errors.tooManyAttempts"));
      else if (code === "SSO_NOT_FOUND") onError(t("sso.notFound"));
      else onError(tc("genericError"));
    }
  }

  if (asking) {
    return (
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          const email = String(new FormData(e.currentTarget).get("sso-email") ?? "").trim();
          void start("email", email);
        }}
      >
        <label className="block space-y-1.5">
          <span className="text-sm text-fg-muted">{t("sso.emailLabel")}</span>
          <Input name="sso-email" type="email" required autoFocus autoComplete="email" />
        </label>
        <div className="flex gap-2">
          <Button type="button" className="flex-1" disabled={pending !== null} onClick={() => setAsking(false)}>
            {t("sso.back")}
          </Button>
          <Button type="submit" variant="primary" className="flex-1" disabled={pending !== null}>
            {pending === "email" ? t("pending") : t("sso.continue")}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <>
      {options.instanceName && (
        <Button className="w-full gap-2" disabled={pending !== null} onClick={() => start("instance")}>
          <KeyRound className="h-4 w-4" aria-hidden />
          {pending === "instance" ? t("pending") : t("social.continueWith", { provider: options.instanceName })}
        </Button>
      )}
      {options.byEmail && (
        <Button className="w-full gap-2" disabled={pending !== null} onClick={() => setAsking(true)}>
          <Building2 className="h-4 w-4" aria-hidden />
          {t("sso.continueWithSso")}
        </Button>
      )}
    </>
  );
}

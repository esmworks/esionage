"use client";

import { Building2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { startSso } from "@/app/(auth)/sso-sign-in";
import { socialErrorKey } from "@/app/(auth)/social-sign-in";
import { wipeAllOfflineData } from "@/components/offline/offline-store";
import { Button } from "@/components/ui";
import { authClient } from "@/lib/auth-client";

export function SsoGate({
  workspaceId,
  workspaceName,
  providerId,
  providerName,
  email,
}: {
  workspaceId: string;
  workspaceName: string;
  providerId: string;
  /** The instance provider's label; empty for the workspace's own connection. */
  providerName: string;
  email: string;
}) {
  const t = useTranslations("security.ssoGate");
  const ta = useTranslations("auth");
  const tc = useTranslations("common");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // A single sign-on that failed comes back here with `?error=`.
    const params = new URLSearchParams(window.location.search);
    const code = params.get("error");
    if (code) setError(ta(`errors.${socialErrorKey(code.trim().toLowerCase().replace(/\s+/g, "_"))}`));
  }, [ta]);

  async function continueWithSso() {
    setPending(true);
    setError(null);
    const result = await startSso({ providerId, callbackURL: `/w/${workspaceId}` });
    if (result.error) {
      setPending(false);
      setError(tc("genericError"));
    }
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <h1 className="text-base font-semibold">{t("title", { workspace: workspaceName })}</h1>
        <p className="text-sm text-fg-muted">{t("body")}</p>
      </div>
      <Button variant="primary" className="w-full gap-2" onClick={continueWithSso} disabled={pending}>
        <Building2 className="h-4 w-4" aria-hidden />
        {pending ? ta("pending") : providerName ? ta("social.continueWith", { provider: providerName }) : t("continue")}
      </Button>
      {error && <p className="text-sm text-danger">{error}</p>}
      <p className="border-t border-border pt-4 text-xs text-fg-muted">
        {t("signedInAs", { email })}{" "}
        <button
          type="button"
          className="text-accent hover:underline"
          onClick={async () => {
            await authClient.signOut();
            await wipeAllOfflineData();
            window.location.assign("/sign-in");
          }}
        >
          {t("signOut")}
        </button>
      </p>
    </div>
  );
}

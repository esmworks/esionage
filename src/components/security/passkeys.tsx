"use client";

import { KeyRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { SettingsRow } from "@/components/settings/section";
import { Button, Input } from "@/components/ui";
import { authClient } from "@/lib/auth-client";
import { defaultPasskeyName } from "@/lib/passkey-name";
import type { PasskeySummary } from "@/server/account-security";
import { useSecurityError } from "./two-factor";

/** Whether this browser can create and use passkeys at all (WebAuthn needs a secure origin). */
export function usePasskeySupport() {
  const [supported, setSupported] = useState<boolean | null>(null);
  useEffect(() => setSupported(typeof window !== "undefined" && "PublicKeyCredential" in window), []);
  return supported;
}

/** Registers a passkey on this device, named after it. */
export async function addPasskey(): Promise<{ ok: boolean; error: { code?: string; status?: number } | null }> {
  const result = await authClient.passkey.addPasskey({ name: defaultPasskeyName(navigator.userAgent) });
  if (result?.error) return { ok: false, error: result.error };
  return { ok: true, error: null };
}

function PasskeyRow({ passkey }: { passkey: PasskeySummary }) {
  const t = useTranslations("security.passkeys");
  const tc = useTranslations("common");
  const format = useFormatter();
  const router = useRouter();
  const describe = useSecurityError();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(passkey.name ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = passkey.name ?? t("unnamed");

  const details = [
    passkey.createdAt && t("added", { date: format.dateTime(new Date(passkey.createdAt), { dateStyle: "medium" }) }),
    passkey.backedUp && t("synced"),
  ].filter(Boolean);

  return (
    <SettingsRow
      title={
        renaming ? (
          <form
            className="flex items-center gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!name.trim()) return;
              setPending(true);
              setError(null);
              const result = await authClient.passkey.updatePasskey({ id: passkey.id, name: name.trim() });
              setPending(false);
              if (result.error) return setError(describe(result.error));
              setRenaming(false);
              router.refresh();
            }}
          >
            <Input
              value={name}
              maxLength={60}
              autoFocus
              aria-label={t("nameLabel")}
              className="w-full sm:w-56"
              onChange={(e) => setName(e.target.value)}
            />
            <Button type="submit" size="sm" variant="primary" disabled={pending || !name.trim()}>
              {tc("save")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setRenaming(false)}>
              {tc("cancel")}
            </Button>
          </form>
        ) : (
          <span className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 shrink-0 text-fg-muted" aria-hidden />
            {label}
          </span>
        )
      }
      description={error ? <span className="text-danger">{error}</span> : details.join(" · ")}
      control={
        !renaming && (
          <>
            <Button size="sm" variant="ghost" onClick={() => setRenaming(true)}>
              {t("rename")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={async () => {
                if (!confirm(t("removeConfirm", { name: label }))) return;
                setPending(true);
                setError(null);
                const result = await authClient.passkey.deletePasskey({ id: passkey.id });
                setPending(false);
                if (result.error) return setError(describe(result.error));
                router.refresh();
              }}
            >
              {tc("remove")}
            </Button>
          </>
        )
      }
    />
  );
}

/** Settings > Account security: passkeys to add, rename and remove. */
export function PasskeySettings({ passkeys }: { passkeys: PasskeySummary[] }) {
  const t = useTranslations("security.passkeys");
  const router = useRouter();
  const describe = useSecurityError();
  const supported = usePasskeySupport();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      {passkeys.map((passkey) => (
        <PasskeyRow key={passkey.id} passkey={passkey} />
      ))}
      <SettingsRow
        title={passkeys.length ? t("addAnother") : t("empty")}
        description={
          error ? (
            <span className="text-danger">{error}</span>
          ) : supported === false ? (
            t("unsupported")
          ) : (
            t("description")
          )
        }
        control={
          <Button
            variant={passkeys.length ? "secondary" : "primary"}
            disabled={pending || supported === false}
            onClick={async () => {
              setPending(true);
              setError(null);
              const result = await addPasskey();
              setPending(false);
              if (result.error) return setError(describe(result.error));
              router.refresh();
            }}
          >
            {t("add")}
          </Button>
        }
      />
    </>
  );
}

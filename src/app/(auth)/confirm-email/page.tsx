import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { findEmailChange } from "@/server/account";
import { ConfirmEmailButton } from "./confirm-email-button";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("account.confirmEmail");
  return { title: t("metaTitle") };
}

/**
 * Target of the link emailed to a new address (see server/account.ts requestEmailChange). Opening
 * it changes nothing: mail scanners open links too. The change happens on the button, which works
 * signed in or not and signs nobody in.
 */
export default async function ConfirmEmailPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token } = await searchParams;
  const t = await getTranslations("account.confirmEmail");
  const change = typeof token === "string" ? await findEmailChange(token) : null;
  if (!change || typeof token !== "string") {
    return (
      <div className="space-y-4">
        <h1 className="text-lg font-semibold">{t("invalidTitle")}</h1>
        <p className="text-sm text-fg-muted">{t("invalidBody")}</p>
        <Link href="/account?tab=profile" className="text-sm text-accent hover:underline">
          {t("toAccount")}
        </Link>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">{t("title")}</h1>
      <p className="text-sm text-fg-muted">{t("body", { old: change.from, new: change.to })}</p>
      <ConfirmEmailButton token={token} />
    </div>
  );
}

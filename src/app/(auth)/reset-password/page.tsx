import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { InvalidResetLink, ResetPasswordForm } from "../password-reset-forms";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.resetPassword");
  return { title: t("metaTitle") };
}

/**
 * Target of the emailed link. Better Auth checks the token at /api/auth/reset-password/:token and
 * redirects here with `?token=` when it is valid, or `?error=INVALID_TOKEN` when not.
 */
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token, error } = await searchParams;
  if (error || typeof token !== "string" || !token) return <InvalidResetLink />;
  return <ResetPasswordForm token={token} />;
}

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { mailStatus, PASSWORD_RESET_MINUTES } from "@/server/mail";
import { AuthNotice, ForgotPasswordForm } from "../password-reset-forms";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.forgotPassword");
  return { title: t("metaTitle") };
}

export default async function ForgotPasswordPage() {
  if (mailStatus() === "disabled") {
    const t = await getTranslations("auth.forgotPassword");
    return (
      <AuthNotice
        title={t("unavailableTitle")}
        body={t("unavailableBody")}
        link={{ href: "/sign-in", label: t("backToSignIn") }}
      />
    );
  }
  return <ForgotPasswordForm minutes={PASSWORD_RESET_MINUTES} />;
}

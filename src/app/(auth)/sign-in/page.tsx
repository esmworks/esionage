import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { env } from "@/lib/env";
import { AuthForm } from "../auth-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.signIn");
  return { title: t("metaTitle") };
}

/** Only same-origin paths, so `?next=` can't send people to another site. */
function safeNext(value: string | string[] | undefined) {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { next, step } = await searchParams;
  return (
    <AuthForm
      mode="sign-in"
      initialStep={step === "two-factor" ? "two-factor" : "credentials"}
      signUpEnabled={!env.signUpDisabled}
      next={safeNext(next)}
      socialProviders={env.enabledSocialProviders}
    />
  );
}

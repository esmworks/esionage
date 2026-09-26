import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { env } from "@/lib/env";
import { AuthForm } from "../auth-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.signUp");
  return { title: t("metaTitle") };
}

export default function SignUpPage() {
  return <AuthForm mode="sign-up" signUpEnabled={!env.signUpDisabled} />;
}

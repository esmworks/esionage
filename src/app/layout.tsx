import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { StaleDeploymentReload } from "@/components/stale-deployment";
import { TimeZoneCookie } from "@/components/time-zone-cookie";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common");
  return {
    title: { default: "Esionage", template: "%s · Esionage" },
    description: t("appDescription"),
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale} suppressHydrationWarning>
      <body>
        <NextIntlClientProvider>
          {children}
          <TimeZoneCookie />
          <StaleDeploymentReload />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}

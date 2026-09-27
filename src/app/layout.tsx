import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { AppShellSetup } from "@/components/offline/install-app";
import { StaleDeploymentReload } from "@/components/stale-deployment";
import { TimeZoneCookie } from "@/components/time-zone-cookie";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common");
  return {
    title: { default: "Esionage", template: "%s · Esionage" },
    description: t("appDescription"),
    applicationName: "Esionage",
    // Added to the home screen on iOS it opens without Safari's bars; the manifest covers the rest.
    appleWebApp: { capable: true, title: "Esionage", statusBarStyle: "default" },
    formatDetection: { telephone: false },
  };
}

// The browser bar (and an installed app's title bar) takes the page background of each theme.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#18191b" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale} suppressHydrationWarning>
      <body>
        <NextIntlClientProvider>
          {children}
          <TimeZoneCookie />
          <StaleDeploymentReload />
          <AppShellSetup />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { OfflinePages } from "./offline-pages";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("offline.page");
  return { title: t("documentTitle"), robots: { index: false } };
}

/**
 * What the service worker (public/sw.js) shows for a page it has no copy of while the server can't
 * be reached. It holds nothing about anyone: the list comes from this browser's own storage.
 */
export default async function OfflinePage() {
  const t = await getTranslations("offline.page");
  return (
    <main className="flex min-h-full items-center justify-center bg-bg-subtle px-4 py-16">
      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center justify-center gap-2 text-lg font-semibold">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-fg text-sm text-bg">e</span>
          Leafdesk
        </div>
        <div className="rounded-xl border border-border bg-bg p-6 shadow-sm">
          <h1 className="text-lg font-semibold">{t("heading")}</h1>
          <p className="mt-2 text-sm text-fg-muted">{t("body")}</p>
          <OfflinePages />
        </div>
      </div>
    </main>
  );
}

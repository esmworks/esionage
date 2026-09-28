"use client";

import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { Button } from "@/components/ui";

/** Last resort for errors outside a workspace; workspaces have their own boundary. */
export default function RootError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const t = useTranslations("common.errorPage");

  useEffect(() => console.error(error), [error]);

  return (
    <div role="alert" className="mx-auto max-w-md space-y-4 px-6 py-24 text-center">
      <h1 className="text-lg font-semibold">{t("title")}</h1>
      <p className="text-sm text-fg-muted">{t("description")}</p>
      <div className="flex justify-center gap-2">
        <Button variant="primary" onClick={retry}>
          {t("retry")}
        </Button>
        {/* A full load, in case the error came from client state a soft navigation would keep. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a
          href="/"
          className="inline-flex h-8 items-center rounded-md border border-border bg-bg px-3 text-sm font-medium transition-colors hover:bg-bg-hover"
        >
          {t("home")}
        </a>
      </div>
    </div>
  );
}

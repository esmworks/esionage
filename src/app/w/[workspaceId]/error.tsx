"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { Button } from "@/components/ui";

/**
 * Anything that throws while rendering a workspace page, including server actions awaited inside
 * transitions. The sidebar stays, since this sits inside the workspace layout.
 */
export default function WorkspaceError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const t = useTranslations("common.errorPage");
  const { workspaceId } = useParams<{ workspaceId: string }>();

  useEffect(() => console.error(error), [error]);

  return (
    <div role="alert" className="mx-auto max-w-md space-y-4 px-6 py-24 text-center">
      <h1 className="text-lg font-semibold">{t("title")}</h1>
      <p className="text-sm text-fg-muted">{t("description")}</p>
      <div className="flex justify-center gap-2">
        <Button variant="primary" onClick={retry}>
          {t("retry")}
        </Button>
        <Link
          href={`/w/${workspaceId}`}
          className="inline-flex h-8 items-center rounded-md border border-border bg-bg px-3 text-sm font-medium transition-colors hover:bg-bg-hover"
        >
          {t("home")}
        </Link>
      </div>
    </div>
  );
}

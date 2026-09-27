"use client";

import { CloudOff } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

/** Above a database (or a row's properties) while it shows what this browser kept: read-only. */
export function OfflineNotice({ savedAt, className }: { savedAt: number | null; className?: string }) {
  const t = useTranslations("offline");
  const locale = useLocale();
  const when = savedAt
    ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(savedAt))
    : null;
  return (
    <p role="status" className={className ?? "mb-2 flex items-center gap-2 text-xs text-fg-muted"}>
      <CloudOff className="h-3.5 w-3.5 shrink-0" />
      <span>{when ? t("readOnlyCopy", { time: when }) : t("readOnly")}</span>
    </p>
  );
}

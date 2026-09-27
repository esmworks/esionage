"use client";

import { Download } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui";
import { useZipExport } from "@/components/use-zip-export";
import { SettingsRow } from "./section";

/** "Export workspace": every page the owner can see, as a ZIP of Markdown, CSV and files. */
export function WorkspaceExport({ workspaceId }: { workspaceId: string }) {
  const t = useTranslations("settings.export");
  const { start, pending, error } = useZipExport();
  return (
    <SettingsRow
      title={t("title")}
      description={error ? <span role="alert" className="text-danger">{error}</span> : t("description")}
      control={
        <Button onClick={() => void start(`/w/${workspaceId}/settings/export.zip`)} disabled={pending}>
          <Download className="h-4 w-4" />
          {pending ? t("preparing") : t("button")}
        </Button>
      }
    />
  );
}

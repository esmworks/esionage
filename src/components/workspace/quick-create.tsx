"use client";

import { Database, FileText, LayoutTemplate } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { createPageAction } from "@/app/actions/pages";
import { Button } from "@/components/ui";
import { markNewPage } from "@/components/page/new-page-focus";
import type { PageKind } from "@/db/schema/app";
import { TemplatesDialog } from "./templates-dialog";

const tile = "max-md:h-auto max-md:flex-col max-md:gap-1.5 max-md:px-1 max-md:py-3 max-md:text-[13px] max-md:leading-tight";

export function QuickCreate({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const t = useTranslations("home");
  const tc = useTranslations("common");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);

  function create(kind: PageKind) {
    setError(false);
    startTransition(async () => {
      try {
        const { id } = await createPageAction({ workspaceId, parentId: null, kind });
        markNewPage(id);
        router.push(`/w/${workspaceId}/p/${id}`);
      } catch {
        setError(true);
      }
    });
  }

  return (
    <div className="space-y-2">
      {/* Phones: three equal tiles, icon over label, so no label has to wrap inside a button. */}
      <div className="grid grid-cols-3 gap-2 md:flex">
        <Button onClick={() => create("page")} disabled={pending} className={tile}>
          <FileText className="h-4 w-4" /> {t("newPage")}
        </Button>
        <Button onClick={() => create("database")} disabled={pending} className={tile}>
          <Database className="h-4 w-4" /> {t("newDatabase")}
        </Button>
        <Button onClick={() => setTemplatesOpen(true)} disabled={pending} className={tile}>
          <LayoutTemplate className="h-4 w-4" /> {t("fromTemplate")}
        </Button>
      </div>
      <TemplatesDialog workspaceId={workspaceId} open={templatesOpen} onClose={() => setTemplatesOpen(false)} />
      {error && (
        <p role="alert" className="text-xs text-danger">
          {tc("genericError")}
        </p>
      )}
    </div>
  );
}

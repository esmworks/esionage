"use client";

import { Database, FileText, LayoutTemplate } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { createPageAction } from "@/app/actions/pages";
import { Button } from "@/components/ui";
import type { PageKind } from "@/db/schema/app";
import { TemplatesDialog } from "./templates-dialog";

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
        router.push(`/w/${workspaceId}/p/${id}`);
      } catch {
        setError(true);
      }
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Button onClick={() => create("page")} disabled={pending}>
          <FileText className="h-4 w-4" /> {t("newPage")}
        </Button>
        <Button onClick={() => create("database")} disabled={pending}>
          <Database className="h-4 w-4" /> {t("newDatabase")}
        </Button>
        <Button onClick={() => setTemplatesOpen(true)} disabled={pending}>
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

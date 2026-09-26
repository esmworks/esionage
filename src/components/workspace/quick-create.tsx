"use client";

import { Database, FileText } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { createPageAction } from "@/app/actions/pages";
import { Button } from "@/components/ui";
import type { PageKind } from "@/db/schema/app";

export function QuickCreate({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const t = useTranslations("home");
  const [pending, startTransition] = useTransition();

  function create(kind: PageKind) {
    startTransition(async () => {
      const { id } = await createPageAction({ workspaceId, parentId: null, kind });
      router.push(`/w/${workspaceId}/p/${id}`);
    });
  }

  return (
    <div className="flex gap-2">
      <Button onClick={() => create("page")} disabled={pending}>
        <FileText className="h-4 w-4" /> {t("newPage")}
      </Button>
      <Button onClick={() => create("database")} disabled={pending}>
        <Database className="h-4 w-4" /> {t("newDatabase")}
      </Button>
    </div>
  );
}

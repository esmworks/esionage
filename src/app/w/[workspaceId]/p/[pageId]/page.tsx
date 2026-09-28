import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { DatabasePage } from "@/components/database/database-page";
import { RowProperties } from "@/components/database/row-properties";
import { PageView } from "@/components/page/page-view";
import { pageLabel } from "@/lib/labels";
import { AccessError, WorkspacePolicyError } from "@/server/access";
import { getPageHeaderInfo } from "@/server/page-meta";
import { getBreadcrumbs, getPage } from "@/server/pages";
import { policyGatePath, requireUser, requireWorkspaceSession } from "@/server/session";

type Params = { params: Promise<{ workspaceId: string; pageId: string }> };

async function load(userId: string, pageId: string) {
  try {
    return await getPage(userId, pageId);
  } catch (error) {
    if (error instanceof WorkspacePolicyError) redirect(policyGatePath(error.workspaceId, error.hold));
    if (error instanceof AccessError) notFound();
    throw error;
  }
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const user = await requireUser();
  const { pageId } = await params;
  const [p, t] = await Promise.all([load(user.id, pageId), getTranslations("common")]);
  await requireWorkspaceSession(p.workspaceId);
  return { title: pageLabel(p.title, t("untitled")) };
}

export default async function PageRoute({ params }: Params) {
  const user = await requireUser();
  const { workspaceId, pageId } = await params;
  const p = await load(user.id, pageId);
  await requireWorkspaceSession(p.workspaceId);
  if (p.workspaceId !== workspaceId) redirect(`/w/${p.workspaceId}/p/${p.id}`);

  const [crumbs, info] = await Promise.all([getBreadcrumbs(user.id, pageId), getPageHeaderInfo(user.id, pageId)]);
  const parent = crumbs.length > 1 ? crumbs[crumbs.length - 2] : null;
  const isRow = parent?.kind === "database";
  const archived = Boolean(p.archivedAt);
  // Viewers see the database and row values but can't change them; the server refuses it too.
  const canEdit = info.level === "edit" || info.level === "full";

  return (
    <PageView
      key={p.id}
      workspaceId={workspaceId}
      page={{ id: p.id, parentId: p.parentId, title: p.title, icon: p.icon, kind: p.kind, archived, isRow }}
      info={info}
      crumbs={crumbs}
      user={{ id: user.id, name: user.name }}
      showBody={p.kind !== "database"}
      wide={p.kind === "database"}
    >
      {p.kind === "database" ? (
        <DatabasePage workspaceId={workspaceId} databaseId={p.id} canEdit={canEdit && !archived} guest={info.guest} exportable={info.exportable} />
      ) : isRow ? (
        <RowProperties workspaceId={workspaceId} databaseId={parent.id} rowId={p.id} readOnly={archived || !canEdit} />
      ) : null}
    </PageView>
  );
}

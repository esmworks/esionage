"use server";

import { revalidatePath } from "next/cache";
import type { PageKind } from "@/db/schema";
import * as pages from "@/server/pages";
import { requireUserId } from "@/server/session";

export async function createPageAction(input: {
  workspaceId: string;
  parentId?: string | null;
  kind?: PageKind;
  title?: string;
}) {
  const userId = await requireUserId();
  const created = await pages.createPage({ userId }, input);
  return { id: created.id };
}

export async function renamePageAction(pageId: string, title: string) {
  const userId = await requireUserId();
  await pages.renamePage({ userId }, pageId, title);
}

export async function setPageIconAction(pageId: string, icon: string | null) {
  const userId = await requireUserId();
  await pages.setPageIcon(userId, pageId, icon);
}

export async function archivePageAction(pageId: string) {
  const userId = await requireUserId();
  const p = await pages.archivePage(userId, pageId);
  revalidatePath(`/w/${p.workspaceId}`, "layout");
}

export async function restorePageAction(pageId: string) {
  const userId = await requireUserId();
  await pages.restorePage(userId, pageId);
}

export async function deletePagePermanentlyAction(pageId: string) {
  const userId = await requireUserId();
  await pages.deletePagePermanently(userId, pageId);
}

export async function movePageAction(pageId: string, parentId: string | null, position?: number) {
  const userId = await requireUserId();
  await pages.movePage(userId, pageId, parentId, position);
}

export async function getTreeAction(workspaceId: string) {
  const userId = await requireUserId();
  return pages.getTree(userId, workspaceId);
}

export async function listTrashAction(workspaceId: string) {
  const userId = await requireUserId();
  const rows = await pages.listTrash(userId, workspaceId);
  return rows.map((r) => ({ id: r.id, title: r.title, icon: r.icon, kind: r.kind, archivedAt: new Date(r.archived_at) }));
}

export async function searchAction(workspaceId: string, query: string) {
  const userId = await requireUserId();
  return pages.searchPages(userId, query, { workspaceId, limit: 20 });
}

export async function listSnapshotsAction(pageId: string) {
  const userId = await requireUserId();
  return pages.listSnapshots(userId, pageId);
}

export async function getSnapshotAction(snapshotId: string) {
  const userId = await requireUserId();
  return pages.getSnapshot(userId, snapshotId);
}

export async function restoreSnapshotAction(snapshotId: string) {
  const userId = await requireUserId();
  await pages.restoreSnapshot({ userId }, snapshotId);
}

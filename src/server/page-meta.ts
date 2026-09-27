import { and, asc, eq, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { page, pageFavorite, type PageKind, user } from "@/db/schema";
import { AccessError, isGuest, pageVisibleTo, requireMembership, resolvePageAccess, type AccessLevel } from "@/server/access";

/** What the page header shows: who made and last changed the page, the viewer's access and star. */
export type PageHeaderInfo = {
  level: AccessLevel;
  /** Guests can't put pages at the top of the workspace. */
  guest: boolean;
  createdAt: Date;
  createdBy: string | null;
  updatedAt: Date;
  updatedBy: string | null;
  favorite: boolean;
  locked: boolean;
};

export async function getPageHeaderInfo(userId: string, pageId: string): Promise<PageHeaderInfo> {
  const { page: found, level } = await resolvePageAccess(userId, pageId);
  if (!found || level === "none") throw new AccessError();
  const creator = alias(user, "creator");
  const editor = alias(user, "editor");
  const [[names], [star], membership] = await Promise.all([
    db
      .select({ createdBy: creator.name, updatedBy: editor.name })
      .from(page)
      .leftJoin(creator, eq(creator.id, page.createdBy))
      .leftJoin(editor, eq(editor.id, page.updatedBy))
      .where(eq(page.id, pageId)),
    db
      .select({ pageId: pageFavorite.pageId })
      .from(pageFavorite)
      .where(and(eq(pageFavorite.userId, userId), eq(pageFavorite.pageId, pageId))),
    requireMembership(userId, found.workspaceId),
  ]);
  return {
    level,
    guest: isGuest(membership.role),
    createdAt: found.createdAt,
    createdBy: names?.createdBy ?? null,
    updatedAt: found.updatedAt,
    updatedBy: names?.updatedBy ?? null,
    favorite: Boolean(star),
    locked: Boolean(found.lockedAt),
  };
}

/** Stars or unstars a page for the user. Anyone who can see a page may star it. */
export async function setFavorite(userId: string, pageId: string, favorite: boolean) {
  const { page: found, level } = await resolvePageAccess(userId, pageId);
  if (!found || level === "none") throw new AccessError();
  if (favorite) {
    await db.insert(pageFavorite).values({ userId, pageId }).onConflictDoNothing();
  } else {
    await db.delete(pageFavorite).where(and(eq(pageFavorite.userId, userId), eq(pageFavorite.pageId, pageId)));
  }
  return { workspaceId: found.workspaceId };
}

export type FavoritePage = { id: string; title: string; icon: string | null; kind: PageKind };

/**
 * The user's starred pages in a workspace, oldest star first. Pages in the trash or no longer
 * visible to them are left out (the star comes back if the page does).
 */
export async function listFavorites(userId: string, workspaceId: string): Promise<FavoritePage[]> {
  await requireMembership(userId, workspaceId);
  return db
    .select({ id: page.id, title: page.title, icon: page.icon, kind: page.kind })
    .from(pageFavorite)
    .innerJoin(page, eq(page.id, pageFavorite.pageId))
    .where(
      and(
        eq(pageFavorite.userId, userId),
        eq(page.workspaceId, workspaceId),
        isNull(page.archivedAt),
        pageVisibleTo(userId),
      ),
    )
    .orderBy(asc(pageFavorite.createdAt));
}

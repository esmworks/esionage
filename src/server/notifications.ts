import { and, count, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { databaseProperty, notification, page, user, type NotificationKind } from "@/db/schema";
import { newAssignees } from "@/lib/properties";
import { pageVisibleTo, requireMembership } from "@/server/access";
import { getCollab } from "@/server/collab/bridge";

/**
 * The in-app inbox: one list per user and workspace. Sidebars in a workspace listen on its signal
 * channel and refetch their own inbox on "inbox", so nothing about the notification itself is
 * broadcast.
 */

export const INBOX_EVENT = "inbox";
/** The inbox shows the latest notifications only. */
const INBOX_LIMIT = 50;

type Change = { rowId: string; before: Record<string, unknown>; after: Record<string, unknown> };

const ids = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

function signal(workspaceId: string) {
  getCollab().broadcast(`ws:${workspaceId}`, INBOX_EVENT);
}

/**
 * Notifies people someone else newly assigned to rows, and takes back unread notifications of
 * anyone the changes unassign, so a mis-click fixed right away leaves nothing behind. Never throws:
 * the edit itself already went through.
 */
export async function recordAssignments(actorId: string, workspaceId: string, personProps: { id: string }[], changes: Change[]) {
  try {
    const removed = changes.flatMap((c) =>
      personProps.flatMap((prop) => {
        const kept = new Set(ids(c.after[prop.id]));
        return ids(c.before[prop.id])
          .filter((userId) => !kept.has(userId))
          .map((userId) => ({ userId, pageId: c.rowId, propertyId: prop.id }));
      }),
    );
    const added = changes.flatMap((c) =>
      newAssignees(personProps, c.before, c.after, actorId).map((a) => ({ ...a, pageId: c.rowId })),
    );
    if (!removed.length && !added.length) return;
    // Dropping the unread ones first also keeps a quick unassign/reassign down to one notification.
    const unread = [...removed, ...added].map((n) =>
      and(eq(notification.userId, n.userId), eq(notification.pageId, n.pageId), eq(notification.propertyId, n.propertyId)),
    );
    await db
      .delete(notification)
      .where(and(eq(notification.kind, "assignment"), isNull(notification.readAt), or(...unread)));
    if (added.length) {
      await db.insert(notification).values(
        added.map((a) => ({
          userId: a.userId,
          workspaceId,
          kind: "assignment" as const,
          actorId,
          pageId: a.pageId,
          propertyId: a.propertyId,
        })),
      );
    }
    signal(workspaceId);
  } catch (error) {
    console.error("could not record assignment notifications", error);
  }
}

export type InboxItem = {
  id: string;
  kind: NotificationKind;
  createdAt: Date;
  read: boolean;
  actorName: string | null;
  pageId: string;
  pageTitle: string;
  pageIcon: string | null;
  databaseTitle: string | null;
  propertyName: string | null;
};

const databasePage = alias(page, "database_page");
const actor = alias(user, "actor");

/** Notifications about pages the user can still open; ones for trashed or unshared rows stay hidden. */
function inboxFilter(userId: string, workspaceId: string) {
  return and(
    eq(notification.userId, userId),
    eq(notification.workspaceId, workspaceId),
    isNull(page.archivedAt),
    pageVisibleTo(userId),
  );
}

export async function listInbox(userId: string, workspaceId: string): Promise<InboxItem[]> {
  await requireMembership(userId, workspaceId);
  const rows = await db
    .select({
      id: notification.id,
      kind: notification.kind,
      createdAt: notification.createdAt,
      readAt: notification.readAt,
      actorName: actor.name,
      pageId: page.id,
      pageTitle: page.title,
      pageIcon: page.icon,
      databaseTitle: databasePage.title,
      propertyName: databaseProperty.name,
    })
    .from(notification)
    .innerJoin(page, eq(page.id, notification.pageId))
    .leftJoin(databasePage, eq(databasePage.id, page.parentId))
    .leftJoin(actor, eq(actor.id, notification.actorId))
    .leftJoin(databaseProperty, eq(databaseProperty.id, notification.propertyId))
    .where(inboxFilter(userId, workspaceId))
    .orderBy(desc(notification.createdAt))
    .limit(INBOX_LIMIT);
  return rows.map(({ readAt, ...row }) => ({ ...row, read: readAt !== null }));
}

export async function unreadCount(userId: string, workspaceId: string) {
  await requireMembership(userId, workspaceId);
  const [row] = await db
    .select({ n: count() })
    .from(notification)
    .innerJoin(page, eq(page.id, notification.pageId))
    .where(and(inboxFilter(userId, workspaceId), isNull(notification.readAt)));
  return row?.n ?? 0;
}

/** Marks the given notifications (or, without ids, the whole inbox) read. */
export async function markRead(userId: string, workspaceId: string, notificationIds?: string[]) {
  await requireMembership(userId, workspaceId);
  if (notificationIds && !notificationIds.length) return;
  await db
    .update(notification)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notification.userId, userId),
        eq(notification.workspaceId, workspaceId),
        isNull(notification.readAt),
        notificationIds ? inArray(notification.id, notificationIds) : undefined,
      ),
    );
  // The user's other tabs update their count too.
  signal(workspaceId);
}

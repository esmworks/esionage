import { and, count, desc, eq, inArray, isNull, or, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { databaseProperty, notification, page, user, workspace, type NotificationKind } from "@/db/schema";
import { newAssignees } from "@/lib/properties";
import { pageVisibleTo, requireMembership } from "@/server/access";
import { getCollab } from "@/server/collab/bridge";
import { mailStatus } from "@/server/mail";
import { requestLocale } from "@/server/mail/locale";
import { inboxKinds } from "@/server/notification-preferences";

/**
 * The in-app inbox: one list per user and workspace. Sidebars in a workspace listen on its signal
 * channel and refetch their own inbox on "inbox", so nothing about the notification itself is
 * broadcast.
 */

export const INBOX_EVENT = "inbox";
/** The inbox shows the latest notifications only. */
const INBOX_LIMIT = 50;
/** How long a share waits before its email goes out, so undoing it right away sends nothing. */
export const SHARE_EMAIL_DELAY_MS = 10_000;

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

/**
 * Tells `userId` that `actorId` shared a page with them, and queues the email about it. A share
 * changed again before it was read stays one notification. Never throws: the share went through.
 */
export async function recordShare(actorId: string, workspaceId: string, userId: string, pageId: string) {
  if (actorId === userId) return;
  try {
    const emailDueAt = mailStatus() === "disabled" ? null : new Date(Date.now() + SHARE_EMAIL_DELAY_MS);
    const emailLocale = await requestLocale();
    await db.transaction(async (tx) => {
      await tx.delete(notification).where(unreadShare(userId, pageId));
      await tx
        .insert(notification)
        .values({ userId, workspaceId, kind: "page_shared", actorId, pageId, emailDueAt, emailLocale });
    });
    signal(workspaceId);
  } catch (error) {
    console.error("could not record share notification", error);
  }
}

/** Takes back the unread share notification (and its email) when that share is removed; never throws. */
export async function withdrawShare(workspaceId: string, userId: string, pageId: string) {
  try {
    const dropped = await db.delete(notification).where(unreadShare(userId, pageId)).returning({ id: notification.id });
    if (dropped.length) signal(workspaceId);
  } catch (error) {
    console.error("could not withdraw share notification", error);
  }
}

const unreadShare = (userId: string, pageId: string) =>
  and(
    eq(notification.kind, "page_shared"),
    eq(notification.userId, userId),
    eq(notification.pageId, pageId),
    isNull(notification.readAt),
  );

export type InboxItem = {
  id: string;
  kind: NotificationKind;
  workspaceId: string;
  workspaceName: string;
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

/**
 * Notifications about pages the user can still open, of the kinds they keep in their inbox; ones
 * for trashed or unshared pages stay hidden. Null when every kind is turned off.
 */
async function inboxFilter(userId: string, workspaceId?: string): Promise<SQL | null> {
  const kinds = await inboxKinds(userId);
  if (!kinds.length) return null;
  return and(
    eq(notification.userId, userId),
    workspaceId ? eq(notification.workspaceId, workspaceId) : undefined,
    inArray(notification.kind, kinds),
    isNull(page.archivedAt),
    pageVisibleTo(userId),
  )!;
}

/**
 * The user's notifications, newest first: in one workspace, or in all of them (MCP). Visibility
 * follows the page, so a workspace the user left shows nothing.
 */
export async function listNotifications(
  userId: string,
  { workspaceId, unreadOnly = false, limit = INBOX_LIMIT }: { workspaceId?: string; unreadOnly?: boolean; limit?: number } = {},
): Promise<InboxItem[]> {
  if (workspaceId) await requireMembership(userId, workspaceId);
  const filter = await inboxFilter(userId, workspaceId);
  if (!filter) return [];
  const rows = await db
    .select({
      id: notification.id,
      kind: notification.kind,
      workspaceId: notification.workspaceId,
      workspaceName: workspace.name,
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
    .innerJoin(workspace, eq(workspace.id, notification.workspaceId))
    .leftJoin(databasePage, and(eq(databasePage.id, page.parentId), eq(databasePage.kind, "database")))
    .leftJoin(actor, eq(actor.id, notification.actorId))
    .leftJoin(databaseProperty, eq(databaseProperty.id, notification.propertyId))
    .where(and(filter, unreadOnly ? isNull(notification.readAt) : undefined))
    .orderBy(desc(notification.createdAt))
    .limit(limit);
  return rows.map(({ readAt, ...row }) => ({ ...row, read: readAt !== null }));
}

export async function listInbox(userId: string, workspaceId: string): Promise<InboxItem[]> {
  return listNotifications(userId, { workspaceId });
}

export async function unreadCount(userId: string, workspaceId: string) {
  await requireMembership(userId, workspaceId);
  const filter = await inboxFilter(userId, workspaceId);
  if (!filter) return 0;
  const [row] = await db
    .select({ n: count() })
    .from(notification)
    .innerJoin(page, eq(page.id, notification.pageId))
    .where(and(filter, isNull(notification.readAt)));
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

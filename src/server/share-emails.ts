import { and, eq, inArray, isNotNull, lte } from "drizzle-orm";
import { db } from "@/db";
import { notification, user, workspace } from "@/db/schema";
import { DEFAULT_LOCALE, isLocale } from "@/i18n/config";
import { env } from "@/lib/env";
import { commentText } from "@/lib/comments";
import { pageLabel } from "@/lib/labels";
import { resolvePageAccess } from "@/server/access";
import { getCollab } from "@/server/collab/bridge";
import { commentEmail, sendMail, shareEmail, type OutgoingMail } from "@/server/mail";
import { emailTranslator } from "@/server/mail/templates";
import { wantsEmail } from "@/server/notification-preferences";

/**
 * Emails people about pages shared with them and comments in their threads. The queue is the
 * notification itself: `recordShare` and `recordComment` set `email_due_at` a little ahead, undoing
 * the share deletes the notification, and the sweep sends what is still there once it falls due.
 * A restart delays these emails instead of losing them.
 */

/** How often the server looks for share emails that are due. */
const SWEEP_INTERVAL_MS = 5_000;

type Due = Pick<
  typeof notification.$inferSelect,
  "kind" | "userId" | "actorId" | "pageId" | "threadId" | "workspaceId" | "emailLocale" | "readAt"
>;

let mailer: (mail: OutgoingMail) => Promise<void> = sendMail;

/** Takes the due emails off the queue (all of them with `everything`) and sends them. */
async function deliverDue(everything = false) {
  // Clearing the due time before sending means an email is sent at most once, even with two sweeps racing.
  const due = await db
    .update(notification)
    .set({ emailDueAt: null })
    .where(
      and(
        inArray(notification.kind, ["page_shared", "comment"]),
        everything ? isNotNull(notification.emailDueAt) : lte(notification.emailDueAt, new Date()),
      ),
    )
    .returning({
      kind: notification.kind,
      userId: notification.userId,
      actorId: notification.actorId,
      pageId: notification.pageId,
      threadId: notification.threadId,
      workspaceId: notification.workspaceId,
      emailLocale: notification.emailLocale,
      readAt: notification.readAt,
    });
  for (const entry of due) {
    try {
      await send(entry);
    } catch (error) {
      console.error(`could not send ${entry.kind} email`, error);
    }
  }
}

/** Sends one email if the person hasn't seen the notification yet, still can open the page and wants it. */
async function send({ kind, userId, actorId, pageId, threadId, workspaceId, emailLocale, readAt }: Due) {
  if (readAt || (kind !== "page_shared" && kind !== "comment")) return;
  const locale = isLocale(emailLocale) ? emailLocale : DEFAULT_LOCALE;
  const { page: target, level } = await resolvePageAccess(userId, pageId);
  if (!target || target.archivedAt || level === "none") return;
  if (!(await wantsEmail(userId, kind))) return;
  // The latest comment someone else wrote in the thread; none when the thread or it was deleted since.
  let text = "";
  if (kind === "comment") {
    const thread = threadId ? (await getCollab().readThreads(pageId)).find((t) => t.id === threadId) : undefined;
    const latest = thread?.comments.findLast((c) => c.userId === actorId && c.body);
    if (!latest) return;
    text = commentText(latest.body);
  }
  const [[recipient], [actor], [space]] = await Promise.all([
    db.select({ email: user.email }).from(user).where(eq(user.id, userId)),
    actorId ? db.select({ name: user.name }).from(user).where(eq(user.id, actorId)) : [],
    db.select({ name: workspace.name }).from(workspace).where(eq(workspace.id, workspaceId)),
  ]);
  if (!recipient?.email) return;
  const pageTitle = pageLabel(target.title, emailTranslator(locale)("share.untitled"));
  const link = `${env.appUrl}/w/${workspaceId}/p/${pageId}`;
  if (kind === "comment") {
    const content = commentEmail(locale, { actorName: actor?.name ?? "", pageTitle, workspaceName: space?.name ?? "", text, link });
    await mailer({ to: recipient.email, ...content });
    return;
  }
  const content = shareEmail(locale, {
    actorName: actor?.name ?? "",
    pageTitle,
    workspaceName: space?.name ?? "",
    level,
    link,
  });
  await mailer({ to: recipient.email, ...content });
}

let sweeping = false;

/** Server only: sends share and comment emails as they fall due, including any left from before a restart. */
export function startShareEmails() {
  const sweep = async () => {
    if (sweeping) return;
    sweeping = true;
    try {
      await deliverDue();
    } catch (error) {
      console.error("could not deliver notification emails", error);
    } finally {
      sweeping = false;
    }
  };
  void sweep();
  const timer = setInterval(() => void sweep(), SWEEP_INTERVAL_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}

/** Scripts and tests: send everything queued now instead of after the delay. */
export async function flushShareEmails() {
  await deliverDue(true);
}

/** Scripts and tests: capture emails instead of sending them (null restores sending). */
export function setShareMailer(send: ((mail: OutgoingMail) => Promise<void>) | null) {
  mailer = send ?? sendMail;
}

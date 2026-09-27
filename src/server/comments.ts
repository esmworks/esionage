import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/schema";
import { cleanCommentBody, CommentError, threadParticipants, type CommentOp, type PlainThread } from "@/lib/comments";
import { AccessError, getMembership, hasLevel, isGuest, requirePageAccess, resolvePageAccess } from "@/server/access";
import { getCollab } from "@/server/collab/bridge";
import type { CommentOpResult } from "@/server/collab/bridge";
import { recordComment, withdrawComments } from "@/server/notifications";
import { workspacePeople } from "@/server/workspaces";

/**
 * Comments on pages. Anyone who can view a page reads its comments; anyone who can edit it writes
 * them. People with full access may also delete other people's comments and whole threads, like
 * BlockNote's "editor" role; everyone else edits and deletes only their own.
 *
 * Every change goes through the server, which writes it into the page's live document, so browsers
 * never write comments themselves and who wrote what can be trusted.
 */

export type CommentUser = { id: string; username: string; avatarUrl: string };

/** Longest reaction, in UTF-16 units: an emoji with its modifiers. */
const MAX_EMOJI = 32;

function cleanEmoji(emoji: unknown): string {
  if (typeof emoji !== "string" || !emoji || emoji.length > MAX_EMOJI || /\s/.test(emoji) || !/\p{Extended_Pictographic}/u.test(emoji)) {
    throw new CommentError("A reaction is one emoji", "invalidBody");
  }
  return emoji;
}

const id = (value: unknown) => {
  if (typeof value !== "string" || !value || value.length > 100) throw new CommentError("That comment doesn't exist anymore", "notFound");
  return value;
};

/** The change as the page stores it: known fields only, bodies cleaned, ids and emoji checked. */
function cleanOp(op: CommentOp): CommentOp {
  switch (op?.type) {
    case "createThread":
      return { type: "createThread", body: cleanCommentBody(op.body) };
    case "addComment":
      return { type: "addComment", threadId: id(op.threadId), body: cleanCommentBody(op.body) };
    case "updateComment":
      return { type: "updateComment", threadId: id(op.threadId), commentId: id(op.commentId), body: cleanCommentBody(op.body) };
    case "deleteComment":
    case "addReaction":
    case "deleteReaction":
      if (op.type === "deleteComment") return { type: op.type, threadId: id(op.threadId), commentId: id(op.commentId) };
      return { type: op.type, threadId: id(op.threadId), commentId: id(op.commentId), emoji: cleanEmoji(op.emoji) };
    case "deleteThread":
    case "resolveThread":
    case "unresolveThread":
      return { type: op.type, threadId: id(op.threadId) };
    default:
      throw new CommentError("Unknown comment change", "invalidBody");
  }
}

/** The page's comment threads, oldest first. */
export async function listComments(userId: string, pageId: string): Promise<PlainThread[]> {
  await requirePageAccess(userId, pageId, "view");
  return getCollab().readThreads(pageId);
}

/**
 * Applies one comment change for `userId`. `quote` anchors a new thread to the first place the page
 * has that text (MCP; browsers mark the selection themselves). Throws AccessError without edit
 * access and CommentError for changes that can't be made.
 */
export async function changeComments(userId: string, pageId: string, op: CommentOp, quote?: string): Promise<CommentOpResult> {
  const { page: target, level } = await resolvePageAccess(userId, pageId);
  if (!target || !hasLevel(level, "edit")) throw new AccessError();
  if (target.archivedAt) throw new CommentError("Pages in the trash can't be commented on", "notAllowed");
  if (quote !== undefined && (typeof quote !== "string" || !quote.trim() || quote.length > 1000)) {
    throw new CommentError("Quote up to 1000 characters of the page", "invalidBody");
  }
  const clean = cleanOp(op);
  const role = hasLevel(level, "full") ? "editor" : "comment";
  const result = await getCollab().commentOp(pageId, { userId, role }, clean, quote);

  if ((clean.type === "createThread" || clean.type === "addComment") && result.thread && result.comment) {
    // Everyone who wrote in the thread before hears about a reply; a new thread tells the page's author.
    const recipients =
      clean.type === "createThread" ? (target.createdBy ? [target.createdBy] : []) : threadParticipants(result.thread, userId, result.comment.id);
    await recordComment(userId, target.workspaceId, pageId, result.thread.id, recipients);
  } else if (clean.type === "deleteThread" || (clean.type === "deleteComment" && !result.thread)) {
    await withdrawComments(target.workspaceId, pageId, clean.threadId);
  }
  return result;
}

/**
 * Names and pictures of people in the page's comments, for BlockNote's comment UI: anyone who wrote
 * or reacted in its threads (they may have left since) and, for members, people in the workspace.
 * Guests only learn about the people in the threads, as with person properties.
 */
export async function commentUsers(userId: string, pageId: string, userIds: string[]): Promise<CommentUser[]> {
  const target = await requirePageAccess(userId, pageId, "view");
  const wanted = Array.isArray(userIds) ? [...new Set(userIds.filter((v) => typeof v === "string"))].slice(0, 200) : [];
  if (!wanted.length) return [];
  const threads = await getCollab().readThreads(pageId);
  const inThreads = new Set(
    threads.flatMap((t) => [...(t.resolvedBy ? [t.resolvedBy] : []), ...t.comments.flatMap((c) => [c.userId, ...c.reactions.flatMap((r) => r.userIds)])]),
  );
  const membership = await getMembership(userId, target.workspaceId);
  const members = new Set(
    membership && !isGuest(membership.role) ? (await workspacePeople(target.workspaceId)).map((p) => p.id) : [],
  );
  const allowed = wanted.filter((v) => members.has(v) || inThreads.has(v));
  if (!allowed.length) return [];
  const rows = await db.select({ id: user.id, name: user.name, image: user.image }).from(user).where(inArray(user.id, allowed));
  return rows.map((r) => ({ id: r.id, username: r.name, avatarUrl: r.image ?? "" }));
}

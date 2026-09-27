import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { pageInvitation, pagePermission, type PageLevel, user, workspaceInvitation, workspaceMember } from "@/db/schema";
import { isEmail, normalizeEmail } from "@/lib/emails";
import { AccessError, getMembership, hasLevel, requirePageAccess, resolvePageAccess } from "@/server/access";
import { addGuest, type InvitationDelivery, inviteGuest } from "@/server/workspaces";

/**
 * Who a page is shared with. An entry gives one member (`userId`) or everyone with a member role
 * (`userId` null) a level on the page and its subpages, until a subpage has its own entry for the
 * same principal. The rule that reads these entries is `page_access_level` in the database.
 */

export type PermissionErrorCode = "notMember" | "lastFullAccess" | "invalidEmail" | "ownersOnly";

export class PermissionError extends Error {
  readonly code: PermissionErrorCode;

  constructor(code: PermissionErrorCode, message: string) {
    super(message);
    this.name = "PermissionError";
    this.code = code;
  }
}

export type PermissionEntry = {
  userId: string | null;
  name: string | null;
  email: string | null;
  image: string | null;
  level: PageLevel;
  /** The page the entry is set on: this page, or the ancestor it is inherited from. */
  sourcePageId: string;
  sourceTitle: string;
  inherited: boolean;
};

/**
 * The entries that apply to a page: for each principal the one on the page itself or its nearest
 * ancestor. Entries for people who have left the workspace are left out, since they grant nothing.
 * `everyone` is what members get without a user entry; `full` when nothing restricts it.
 */
export async function listPagePermissions(userId: string, pageId: string) {
  const { page: target, level } = await resolvePageAccess(userId, pageId);
  if (!target || !hasLevel(level, "view")) throw new AccessError();
  const rows = await db.execute<{
    user_id: string | null;
    level: PageLevel;
    page_id: string;
    title: string;
    name: string | null;
    email: string | null;
    image: string | null;
  }>(sql`
    with recursive chain as (
      select id, parent_id, 0 as depth from page where id = ${pageId}
      union all
      select p.id, p.parent_id, c.depth + 1 from page p join chain c on p.id = c.parent_id where c.depth < 64
    )
    select distinct on (pp.user_id) pp.user_id, pp.level, pp.page_id, src.title, u.name, u.email, u.image
    from chain c
    join page_permission pp on pp.page_id = c.id
    join page src on src.id = c.id
    left join "user" u on u.id = pp.user_id
    where pp.user_id is null
      or exists (
        select 1 from ${workspaceMember} wm
        where wm.workspace_id = ${target.workspaceId} and wm.user_id = pp.user_id
      )
    order by pp.user_id nulls first, c.depth
  `);
  const entries: PermissionEntry[] = rows.map((r) => ({
    userId: r.user_id,
    name: r.name,
    email: r.email,
    image: r.image,
    level: r.level,
    sourcePageId: r.page_id,
    sourceTitle: r.title,
    inherited: r.page_id !== pageId,
  }));
  const everyone = entries.find((e) => e.userId === null)?.level ?? "full";
  // Only those who manage the page see whom it waits for.
  const invitations = hasLevel(level, "full")
    ? await db
        .select({ email: pageInvitation.email, level: pageInvitation.level })
        .from(pageInvitation)
        .where(eq(pageInvitation.pageId, pageId))
        .orderBy(asc(pageInvitation.createdAt))
    : [];
  return { level, everyone, entries: entries.filter((e) => e.userId !== null), invitations };
}

export type ShareByEmailResult =
  | { kind: "shared" }
  | { kind: "added" }
  | { kind: "invited"; email: string; link: string; delivery: InvitationDelivery };

/**
 * Shares the page with whoever uses `email`. Someone in the workspace gets the level right away;
 * an account outside it joins as a guest; anyone else is invited as a guest and gets the page
 * once they accept. Needs full access, and bringing new people in is up to the workspace owners.
 */
export async function sharePageByEmail(
  actorId: string,
  pageId: string,
  email: string,
  level: Exclude<PageLevel, "none">,
): Promise<ShareByEmailResult> {
  const target = await requirePageAccess(actorId, pageId, "full");
  const clean = normalizeEmail(email);
  if (!isEmail(clean)) throw new PermissionError("invalidEmail", "Enter a valid email address");
  const [account] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(sql`lower(${user.email})`, clean))
    .limit(1);
  if (account && (await getMembership(account.id, target.workspaceId))) {
    await setPagePermission(actorId, pageId, account.id, level);
    return { kind: "shared" };
  }
  if ((await getMembership(actorId, target.workspaceId))?.role !== "owner") {
    throw new PermissionError("ownersOnly", "Only workspace owners can share pages with new people");
  }
  if (account) {
    await addGuest(actorId, target.workspaceId, account.id, clean);
    await setPagePermission(actorId, pageId, account.id, level);
    return { kind: "added" };
  }
  await db
    .insert(pageInvitation)
    .values({ pageId, workspaceId: target.workspaceId, email: clean, level, invitedBy: actorId })
    .onConflictDoUpdate({
      target: [pageInvitation.pageId, pageInvitation.email],
      set: { level, invitedBy: actorId, createdAt: new Date() },
    });
  const { link, delivery } = await inviteGuest(actorId, target.workspaceId, clean);
  return { kind: "invited", email: clean, link, delivery };
}

/**
 * Stops waiting for `email` on this page. A guest invitation that no page waits on any more is
 * withdrawn too, since it would only let them into an empty workspace. Needs full access.
 */
export async function removePageInvitation(actorId: string, pageId: string, email: string) {
  const target = await requirePageAccess(actorId, pageId, "full");
  const clean = normalizeEmail(email);
  await db.transaction(async (tx) => {
    await tx.delete(pageInvitation).where(and(eq(pageInvitation.pageId, pageId), eq(pageInvitation.email, clean)));
    const [left] = await tx
      .select({ id: pageInvitation.id })
      .from(pageInvitation)
      .where(and(eq(pageInvitation.workspaceId, target.workspaceId), eq(pageInvitation.email, clean)))
      .limit(1);
    if (!left) {
      await tx
        .delete(workspaceInvitation)
        .where(
          and(
            eq(workspaceInvitation.workspaceId, target.workspaceId),
            eq(workspaceInvitation.email, clean),
            eq(workspaceInvitation.role, "guest"),
          ),
        );
    }
  });
}

/** Sets what `principal` (a member's id, or null for everyone) gets on the page. Needs full access. */
export async function setPagePermission(actorId: string, pageId: string, principal: string | null, level: PageLevel) {
  const target = await requirePageAccess(actorId, pageId, "full");
  if (principal && !(await getMembership(principal, target.workspaceId))) {
    throw new PermissionError("notMember", "Pages can only be shared with workspace members");
  }
  await changePermissions(target.workspaceId, pageId, async (tx) => {
    await tx
      .insert(pagePermission)
      .values({ pageId, workspaceId: target.workspaceId, userId: principal, level, createdBy: actorId })
      .onConflictDoUpdate({
        target: [pagePermission.pageId, pagePermission.userId],
        set: { level, createdBy: actorId, createdAt: new Date() },
      });
  });
}

/** Removes the page's own entry for `principal`, so it inherits again. Needs full access. */
export async function removePagePermission(actorId: string, pageId: string, principal: string | null) {
  const target = await requirePageAccess(actorId, pageId, "full");
  await changePermissions(target.workspaceId, pageId, async (tx) => {
    await tx
      .delete(pagePermission)
      .where(
        and(
          eq(pagePermission.pageId, pageId),
          principal ? eq(pagePermission.userId, principal) : isNull(pagePermission.userId),
        ),
      );
  });
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Applies a change and rolls it back if it leaves the page, or a subpage with entries of its own,
 * without any member who has full access: nobody could share or delete it any more. Changes in one
 * workspace are serialized so two of them can't each pass the check and together fail it.
 */
async function changePermissions(workspaceId: string, pageId: string, change: (tx: Tx) => Promise<void>) {
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`page_permission:${workspaceId}`}))`);
    await change(tx);
    const orphans = await tx.execute<{ id: string }>(sql`
      with recursive sub as (
        select id from page where id = ${pageId}
        union all
        select p.id from page p join sub on p.parent_id = sub.id
      )
      select s.id from sub s
      where (s.id = ${pageId} or exists (select 1 from ${pagePermission} pp where pp.page_id = s.id))
        and not exists (
          select 1 from ${workspaceMember} wm
          where wm.workspace_id = ${workspaceId} and page_access_level(wm.user_id, s.id) = 3
        )
      limit 1
    `);
    if (orphans.length) {
      throw new PermissionError("lastFullAccess", "Someone in the workspace must keep full access to the page");
    }
  });
}

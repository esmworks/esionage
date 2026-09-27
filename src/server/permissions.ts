import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { pagePermission, type PageLevel, workspaceMember } from "@/db/schema";
import { AccessError, getMembership, hasLevel, requirePageAccess, resolvePageAccess } from "@/server/access";

/**
 * Who a page is shared with. An entry gives one member (`userId`) or everyone with a member role
 * (`userId` null) a level on the page and its subpages, until a subpage has its own entry for the
 * same principal. The rule that reads these entries is `page_access_level` in the database.
 */

export type PermissionErrorCode = "notMember" | "lastFullAccess";

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
  return { level, everyone, entries: entries.filter((e) => e.userId !== null) };
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

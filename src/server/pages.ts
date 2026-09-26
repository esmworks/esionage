import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  databaseProperty,
  databaseView,
  oauthClient,
  page,
  pageSnapshot,
  workspace,
  workspaceMember,
  type PageKind,
  user,
} from "@/db/schema";
import { AccessError, requireMembership, requirePageAccess } from "@/server/access";
import { getCollab, type WriteActor } from "@/server/collab/bridge";
import { normalizeRowProperties, withCode } from "@/server/databases";

export type TreeNode = {
  id: string;
  parentId: string | null;
  kind: PageKind;
  title: string;
  icon: string | null;
  position: number;
};

export async function listWorkspaces(userId: string) {
  return db
    .select({ id: workspace.id, name: workspace.name, icon: workspace.icon, role: workspaceMember.role })
    .from(workspace)
    .innerJoin(workspaceMember, eq(workspaceMember.workspaceId, workspace.id))
    .where(eq(workspaceMember.userId, userId))
    .orderBy(asc(workspace.createdAt));
}

/** Sidebar tree: every live page except database rows (those live inside their database). */
export async function getTree(userId: string, workspaceId: string): Promise<TreeNode[]> {
  await requireMembership(userId, workspaceId);
  const rows = await db.execute<{
    id: string;
    parent_id: string | null;
    kind: PageKind;
    title: string;
    icon: string | null;
    position: number;
  }>(sql`
    select p.id, p.parent_id, p.kind, p.title, p.icon, p.position
    from ${page} p
    left join ${page} parent on parent.id = p.parent_id
    where p.workspace_id = ${workspaceId}
      and p.archived_at is null
      and (parent.id is null or parent.kind <> 'database')
    order by p.position, p.created_at
  `);
  return rows.map((r) => ({
    id: r.id,
    parentId: r.parent_id,
    kind: r.kind,
    title: r.title,
    icon: r.icon,
    position: Number(r.position),
  }));
}

export async function getPage(userId: string, pageId: string) {
  return requirePageAccess(userId, pageId);
}

export async function getBreadcrumbs(userId: string, pageId: string) {
  await requirePageAccess(userId, pageId);
  const rows = await db.execute<{ id: string; title: string; icon: string | null; kind: PageKind; depth: number }>(sql`
    with recursive chain as (
      select id, parent_id, title, icon, kind, 0 as depth from ${page} where id = ${pageId}
      union all
      select p.id, p.parent_id, p.title, p.icon, p.kind, c.depth + 1
      from ${page} p join chain c on p.id = c.parent_id
    )
    select id, title, icon, kind, depth from chain order by depth desc
  `);
  return rows.map((r) => ({ id: r.id, title: r.title, icon: r.icon, kind: r.kind }));
}

async function nextPosition(workspaceId: string, parentId: string | null) {
  const [row] = await db
    .select({ max: sql<number | null>`max(${page.position})` })
    .from(page)
    .where(and(eq(page.workspaceId, workspaceId), parentId ? eq(page.parentId, parentId) : isNull(page.parentId)));
  return (Number(row?.max) || 0) + 1;
}

export type CreatePageInput = {
  workspaceId: string;
  parentId?: string | null;
  kind?: PageKind;
  title?: string;
  icon?: string | null;
  markdown?: string;
  /** Row values, keyed by property id or name, when the parent is a database. */
  properties?: Record<string, unknown>;
  /** Names for a new database's starter properties and view, in the creator's language. */
  seedNames?: DatabaseSeedNames;
};

export type DatabaseSeedNames = {
  status: string;
  notStarted: string;
  inProgress: string;
  done: string;
  tags: string;
  table: string;
};

/** Used when no language is known, e.g. databases created by MCP clients. */
export const ENGLISH_SEED_NAMES: DatabaseSeedNames = {
  status: "Status",
  notStarted: "Not started",
  inProgress: "In progress",
  done: "Done",
  tags: "Tags",
  table: "Table",
};

export async function createPage(actor: WriteActor, input: CreatePageInput) {
  const { userId } = actor;
  const kind = input.kind ?? "page";
  let workspaceId = input.workspaceId;
  let parentKind: PageKind | null = null;
  if (input.parentId) {
    const parent = await requirePageAccess(userId, input.parentId);
    workspaceId = parent.workspaceId;
    parentKind = parent.kind;
    if (parent.archivedAt) throw withCode(new AccessError("Parent page is in the trash"), "parentInTrash");
    if (parent.kind === "database" && kind === "database") {
      throw withCode(new Error("A database can't contain another database"), "nestedDatabase");
    }
  } else {
    await requireMembership(userId, workspaceId);
  }

  const properties =
    parentKind === "database" && input.properties
      ? await normalizeRowProperties(input.parentId!, input.properties)
      : {};

  const [created] = await db
    .insert(page)
    .values({
      workspaceId,
      parentId: input.parentId ?? null,
      kind,
      title: input.title?.trim() ?? "",
      icon: input.icon ?? null,
      properties,
      position: await nextPosition(workspaceId, input.parentId ?? null),
      createdBy: userId,
      updatedBy: userId,
    })
    .returning();

  if (kind === "database") {
    const names = input.seedNames ?? ENGLISH_SEED_NAMES;
    await db.insert(databaseProperty).values([
      {
        databaseId: created.id,
        name: names.status,
        type: "select",
        position: 1,
        options: {
          options: [
            { id: crypto.randomUUID(), name: names.notStarted, color: "gray" },
            { id: crypto.randomUUID(), name: names.inProgress, color: "blue" },
            { id: crypto.randomUUID(), name: names.done, color: "green" },
          ],
        },
      },
      { databaseId: created.id, name: names.tags, type: "multi_select", position: 2, options: { options: [] } },
    ]);
    await db.insert(databaseView).values({ databaseId: created.id, name: names.table, type: "table", position: 1 });
  }

  const collab = getCollab();
  if (input.markdown?.trim()) await collab.replaceContent(created.id, input.markdown, actor);
  collab.broadcast(`ws:${workspaceId}`, "tree");
  if (parentKind === "database") collab.broadcast(`db:${input.parentId}`, "rows");
  return created;
}

export async function renamePage(actor: WriteActor, pageId: string, title: string) {
  await requirePageAccess(actor.userId, pageId);
  // Title lives in the shared doc so open editors update live; the store hook persists it.
  await getCollab().setTitle(pageId, title.trim(), actor);
}

export async function setPageIcon(userId: string, pageId: string, icon: string | null) {
  const p = await requirePageAccess(userId, pageId);
  await db.update(page).set({ icon, updatedBy: userId }).where(eq(page.id, pageId));
  getCollab().broadcast(`ws:${p.workspaceId}`, "tree");
  if (p.parentId) getCollab().broadcast(`db:${p.parentId}`, "rows");
}

function subtreeIds(rootId: string) {
  return sql`(
    with recursive sub as (
      select id from ${page} where id = ${rootId}
      union all
      select p.id from ${page} p join sub on p.parent_id = sub.id
    ) select id from sub
  )`;
}

export async function archivePage(userId: string, pageId: string) {
  const p = await requirePageAccess(userId, pageId);
  await db
    .update(page)
    .set({ archivedAt: new Date(), updatedBy: userId })
    .where(and(sql`${page.id} in ${subtreeIds(pageId)}`, isNull(page.archivedAt)));
  getCollab().broadcast(`ws:${p.workspaceId}`, "tree");
  if (p.parentId) getCollab().broadcast(`db:${p.parentId}`, "rows");
  return p;
}

export async function restorePage(userId: string, pageId: string) {
  const p = await requirePageAccess(userId, pageId);
  // Restoring under an archived parent would leave the page unreachable; lift it to the root.
  let parentId = p.parentId;
  if (parentId) {
    const [parent] = await db.select({ archivedAt: page.archivedAt }).from(page).where(eq(page.id, parentId));
    if (!parent || parent.archivedAt) parentId = null;
  }
  await db.update(page).set({ archivedAt: null }).where(sql`${page.id} in ${subtreeIds(pageId)}`);
  if (parentId !== p.parentId) await db.update(page).set({ parentId }).where(eq(page.id, pageId));
  getCollab().broadcast(`ws:${p.workspaceId}`, "tree");
  if (parentId) getCollab().broadcast(`db:${parentId}`, "rows");
}

export async function deletePagePermanently(userId: string, pageId: string) {
  const p = await requirePageAccess(userId, pageId);
  if (!p.archivedAt) throw new Error("Move the page to the trash before deleting it");
  await db.delete(page).where(eq(page.id, pageId));
  getCollab().broadcast(`ws:${p.workspaceId}`, "tree");
}

export async function listTrash(userId: string, workspaceId: string) {
  await requireMembership(userId, workspaceId);
  // Only roots of archived subtrees; their descendants come back with them.
  return db.execute<{ id: string; title: string; icon: string | null; kind: PageKind; archived_at: Date }>(sql`
    select p.id, p.title, p.icon, p.kind, p.archived_at
    from ${page} p
    left join ${page} parent on parent.id = p.parent_id
    where p.workspace_id = ${workspaceId}
      and p.archived_at is not null
      and (parent.id is null or parent.archived_at is null or parent.archived_at <> p.archived_at)
    order by p.archived_at desc
    limit 100
  `);
}

export async function movePage(userId: string, pageId: string, newParentId: string | null, position?: number) {
  const p = await requirePageAccess(userId, pageId);
  if (newParentId) {
    const parent = await requirePageAccess(userId, newParentId);
    if (parent.workspaceId !== p.workspaceId) throw new AccessError("Cannot move across workspaces");
    if (parent.kind === "database" && p.kind === "database") throw new Error("A database cannot be a row");
    const cycle = await db.execute<{ hit: number }>(
      sql`select 1 as hit from ${subtreeIds(pageId)} s where s.id = ${newParentId}`,
    );
    if (cycle.length) throw new Error("Cannot move a page inside itself");
  }
  await db
    .update(page)
    .set({ parentId: newParentId, position: position ?? (await nextPosition(p.workspaceId, newParentId)) })
    .where(eq(page.id, pageId));
  getCollab().broadcast(`ws:${p.workspaceId}`, "tree");
  for (const id of [p.parentId, newParentId]) if (id) getCollab().broadcast(`db:${id}`, "rows");
}

export type SearchHit = {
  id: string;
  workspaceId: string;
  parentId: string | null;
  kind: PageKind;
  title: string;
  icon: string | null;
  snippet: string;
  updatedAt: Date;
};

/** Title + body search across the user's workspaces (or one workspace), newest first on ties. */
export async function searchPages(
  userId: string,
  query: string,
  { workspaceId, limit = 20 }: { workspaceId?: string; limit?: number } = {},
): Promise<SearchHit[]> {
  const q = query.trim();
  if (!q) return [];
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const rows = await db.execute<{
    id: string;
    workspace_id: string;
    parent_id: string | null;
    kind: PageKind;
    title: string;
    icon: string | null;
    content_text: string;
    updated_at: Date;
    rank: number;
  }>(sql`
    select p.id, p.workspace_id, p.parent_id, p.kind, p.title, p.icon, p.content_text, p.updated_at,
      (case when p.title ilike ${like} then 2 else 0 end)
      + ts_rank(to_tsvector('simple', coalesce(p.title, '') || ' ' || coalesce(p.content_text, '')),
                plainto_tsquery('simple', ${q})) as rank
    from ${page} p
    join ${workspaceMember} m on m.workspace_id = p.workspace_id and m.user_id = ${userId}
    where p.archived_at is null
      ${workspaceId ? sql`and p.workspace_id = ${workspaceId}` : sql``}
      and (
        p.title ilike ${like} or p.content_text ilike ${like}
        or to_tsvector('simple', coalesce(p.title, '') || ' ' || coalesce(p.content_text, ''))
           @@ plainto_tsquery('simple', ${q})
      )
    order by rank desc, p.updated_at desc
    limit ${limit}
  `);
  return rows.map((r) => ({
    id: r.id,
    workspaceId: r.workspace_id,
    parentId: r.parent_id,
    kind: r.kind,
    title: r.title,
    icon: r.icon,
    snippet: makeSnippet(r.content_text, q),
    updatedAt: new Date(r.updated_at),
  }));
}

function makeSnippet(text: string, q: string) {
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i === -1) return text.slice(0, 140);
  const start = Math.max(0, i - 50);
  return (start ? "…" : "") + text.slice(start, i + q.length + 90).replace(/\s+/g, " ");
}

export async function listChildren(userId: string, workspaceId: string, parentId: string | null) {
  await requireMembership(userId, workspaceId);
  if (parentId) await requirePageAccess(userId, parentId);
  return db
    .select({ id: page.id, kind: page.kind, title: page.title, icon: page.icon, updatedAt: page.updatedAt })
    .from(page)
    .where(
      and(
        eq(page.workspaceId, workspaceId),
        parentId ? eq(page.parentId, parentId) : isNull(page.parentId),
        isNull(page.archivedAt),
      ),
    )
    .orderBy(asc(page.position));
}

export async function listSnapshots(userId: string, pageId: string) {
  await requirePageAccess(userId, pageId);
  return db
    .select({
      id: pageSnapshot.id,
      title: pageSnapshot.title,
      reason: pageSnapshot.reason,
      createdAt: pageSnapshot.createdAt,
      authorName: user.name,
      clientName: oauthClient.name,
    })
    .from(pageSnapshot)
    .leftJoin(user, eq(user.id, pageSnapshot.createdBy))
    .leftJoin(oauthClient, eq(oauthClient.clientId, pageSnapshot.oauthClientId))
    .where(eq(pageSnapshot.pageId, pageId))
    .orderBy(desc(pageSnapshot.createdAt))
    .limit(100);
}

export async function getSnapshot(userId: string, snapshotId: string) {
  const [snap] = await db
    .select({
      id: pageSnapshot.id,
      pageId: pageSnapshot.pageId,
      title: pageSnapshot.title,
      contentMarkdown: pageSnapshot.contentMarkdown,
      createdAt: pageSnapshot.createdAt,
    })
    .from(pageSnapshot)
    .where(eq(pageSnapshot.id, snapshotId));
  if (!snap) throw new AccessError();
  await requirePageAccess(userId, snap.pageId);
  return snap;
}

export async function restoreSnapshot(actor: WriteActor, snapshotId: string) {
  const snap = await getSnapshot(actor.userId, snapshotId);
  await getCollab().restoreSnapshot(snapshotId, actor);
  return snap.pageId;
}

export async function recentPages(userId: string, workspaceId: string, limit = 8) {
  await requireMembership(userId, workspaceId);
  return db
    .select({ id: page.id, title: page.title, icon: page.icon, kind: page.kind, updatedAt: page.updatedAt })
    .from(page)
    .where(and(eq(page.workspaceId, workspaceId), isNull(page.archivedAt)))
    .orderBy(desc(page.updatedAt))
    .limit(limit);
}


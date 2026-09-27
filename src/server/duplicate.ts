import { and, asc, eq, gt, inArray, isNull, like, sql } from "drizzle-orm";
import * as Y from "yjs";
import { db } from "@/db";
import { databaseProperty, databaseView, page, pagePermission, type PageKind, type RowProperties } from "@/db/schema";
import { planDuplicate, type DuplicatePlan, type SourcePage } from "@/lib/duplicate";
import { DATABASE_BLOCK, mapReferenceLines, referenceLine, remapInlineDatabases } from "@/lib/embed-blocks";
import { positionBetween } from "@/lib/properties";
import { AccessError, pageVisibleTo, requirePageAccess } from "@/server/access";
import { getCollab, type WriteActor } from "@/server/collab/bridge";
import { bulkRowIds, rowsWithAccess, syncPairedRelations, withCode, type BulkResult } from "@/server/databases";
import { makePagePrivate } from "@/server/permissions";
import { requireTopLevel } from "@/server/workspaces";

/** Larger subtrees are refused rather than copied in one long transaction. */
export const MAX_DUPLICATE_PAGES = 2000;

/**
 * Copies a page and everything live under it (subpages, databases with their properties, views
 * and rows, pages inside rows) next to the original. Only what the user can see is copied.
 * Each page's own permission entries are copied too, so a copy is never visible to more people
 * than its source; a guest's top-level copy is theirs alone, like any top-level page they add.
 * Favorites, publication, history and locks stay with the original.
 */
export async function duplicatePage(
  actor: WriteActor,
  pageId: string,
  copySuffix: string,
  /** False when the caller tells open views about several copies at once. */
  { notify = true }: { notify?: boolean } = {},
): Promise<{ id: string; workspaceId: string }> {
  const { userId } = actor;
  const source = await requirePageAccess(userId, pageId, "view");
  if (source.archivedAt) throw new Error("Restore the page from the trash before duplicating it");
  // The copy lands beside the original, so the user needs to be allowed to add pages there.
  let parentKind: PageKind | null = null;
  let topLevel: "shared" | "private" | null = null;
  if (source.parentId) {
    const parent = await requirePageAccess(userId, source.parentId, "edit");
    if (parent.archivedAt) throw withCode(new AccessError("Parent page is in the trash"), "parentInTrash");
    parentKind = parent.kind;
  } else {
    topLevel = await requireTopLevel(userId, source.workspaceId);
  }
  const title = `${source.title}${copySuffix}`.trim();

  const plan = await db.transaction(async (tx) => {
    // Walk down live pages the user can see; a hidden page hides its whole subtree.
    const pages = await tx.execute<{
      id: string;
      parent_id: string | null;
      kind: PageKind;
      title: string;
      position: number;
      properties: RowProperties;
    }>(sql`
      with recursive sub as (
        select id from ${page} where id = ${pageId}
        union all
        select p.id from ${page} p join sub on p.parent_id = sub.id
        where p.archived_at is null and ${pageVisibleTo(userId, "p")}
      )
      select p.id, p.parent_id, p.kind, p.title, p.position, p.properties
      from (select id from sub limit ${MAX_DUPLICATE_PAGES + 1}) s
      join ${page} p on p.id = s.id
    `);
    if (pages.length > MAX_DUPLICATE_PAGES) {
      throw new Error(`Can't duplicate more than ${MAX_DUPLICATE_PAGES} pages at once`);
    }

    const databaseIds = pages.filter((p) => p.kind === "database").map((p) => p.id);
    const [properties, views] = databaseIds.length
      ? await Promise.all([
          tx.select().from(databaseProperty).where(inArray(databaseProperty.databaseId, databaseIds)),
          tx.select().from(databaseView).where(inArray(databaseView.databaseId, databaseIds)),
        ])
      : [[], []];

    // Right after the original: halfway to the next sibling, or one past it when it is last.
    const [next] = await tx
      .select({ position: page.position })
      .from(page)
      .where(
        and(
          eq(page.workspaceId, source.workspaceId),
          source.parentId ? eq(page.parentId, source.parentId) : isNull(page.parentId),
          gt(page.position, source.position),
        ),
      )
      .orderBy(asc(page.position))
      .limit(1);

    const plan = planDuplicate({
      rootId: pageId,
      pages: pages.map(
        (p): SourcePage => ({
          id: p.id,
          parentId: p.parent_id,
          kind: p.kind,
          title: p.title,
          position: Number(p.position),
          properties: p.properties,
        }),
      ),
      properties,
      views,
      rootTitle: title,
      rootPosition: positionBetween(source.position, next?.position),
    });

    // One statement for all pages, so the bodies (ydoc can be large) are copied inside Postgres
    // and foreign keys to parents are checked once every page exists.
    const rows = plan.pages.map((p) => ({
      id: p.id,
      source_id: p.sourceId,
      parent_id: p.parentId,
      title: p.title,
      position: p.position,
      properties: p.properties,
    }));
    const inserted = await tx.execute<{ id: string }>(sql`
      insert into ${page} (id, workspace_id, parent_id, kind, title, icon, position, properties,
        ydoc, content_text, content_markdown, created_by, updated_by)
      select m.id, src.workspace_id, m.parent_id, src.kind, m.title, src.icon, m.position, m.properties,
        src.ydoc, src.content_text, src.content_markdown, ${userId}, ${userId}
      from jsonb_to_recordset(${JSON.stringify(rows)}::jsonb)
        as m(id text, source_id text, parent_id text, title text, position double precision, properties jsonb)
      join ${page} src on src.id = m.source_id
      returning id
    `);
    // A page deleted since the walk would leave a hole in the copy; start over instead.
    if (inserted.length !== rows.length) throw new Error("The page changed while duplicating it; try again");

    // Entries inherited from above need nothing: the copy sits under the same parent.
    await tx.execute(sql`
      insert into ${pagePermission} (id, page_id, workspace_id, user_id, level, created_by)
      select gen_random_uuid()::text, m.id, pp.workspace_id, pp.user_id, pp.level, ${userId}
      from jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) as m(id text, source_id text)
      join ${pagePermission} pp on pp.page_id = m.source_id
    `);
    if (topLevel === "private") await makePagePrivate(tx, source.workspaceId, plan.rootId, userId);
    await pointAtCopiedDatabases(tx, plan);

    if (plan.properties.length) {
      await tx.insert(databaseProperty).values(
        plan.properties.map(({ id, databaseId, name, type, options, position }) => ({
          id,
          databaseId,
          name,
          type,
          options,
          position,
        })),
      );
    }
    if (plan.views.length) {
      await tx.insert(databaseView).values(
        plan.views.map(({ id, databaseId, name, type, config, position }) => ({ id, databaseId, name, type, config, position })),
      );
    }
    return plan;
  });

  // A row copied into its database links to the same rows; two-way relations mirror that.
  if (parentKind === "database") {
    const root = plan.pages.find((p) => p.id === plan.rootId)!;
    await syncPairedRelations(plan.rootId, source.parentId!, {}, root.properties);
  }

  const collab = getCollab();
  // The copied doc still carries the original title; the store hook persists the new one.
  await collab.setTitle(plan.rootId, title, actor);
  if (notify) {
    collab.broadcast(`ws:${source.workspaceId}`, "tree");
    if (parentKind === "database") collab.broadcast(`db:${source.parentId}`, "rows");
  }
  return { id: plan.rootId, workspaceId: source.workspaceId };
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Copied pages showing an inline database that was copied with them show the copy instead (in
 * their document and in their derived Markdown); linked views keep showing their source.
 */
async function pointAtCopiedDatabases(tx: Tx, plan: DuplicatePlan) {
  const copies = plan.pages.filter((p) => p.kind === "page").map((p) => p.id);
  if (!copies.length) return;
  const bodies = await tx
    .select({ id: page.id, ydoc: page.ydoc, markdown: page.contentMarkdown })
    .from(page)
    .where(and(inArray(page.id, copies), like(page.contentMarkdown, "%<!-- esionage:database %")));
  for (const body of bodies) {
    if (!body.ydoc?.byteLength) continue;
    const doc = new Y.Doc();
    try {
      Y.applyUpdate(doc, body.ydoc);
      if (!remapInlineDatabases(doc, plan.pageIds)) continue;
      const markdown = mapReferenceLines(body.markdown, (ref) =>
        referenceLine(ref.type, ref.type === DATABASE_BLOCK ? (plan.pageIds.get(ref.databaseId) ?? ref.databaseId) : ref.databaseId),
      );
      await tx.update(page).set({ ydoc: Y.encodeStateAsUpdate(doc), contentMarkdown: markdown }).where(eq(page.id, body.id));
    } finally {
      doc.destroy();
    }
  }
}

/**
 * Duplicates several rows of a database, each copy right after its original (see duplicatePage).
 * Needs edit access to the database, like adding a row. Rows the user can't see, rows in the
 * trash and ids of other pages are skipped and returned. Each row is copied in its own
 * transaction, so an error part way keeps the copies made so far; open views hear about all of
 * them once.
 */
export async function duplicateRows(
  actor: WriteActor,
  databaseId: string,
  rowIds: string[],
  copySuffix: string,
): Promise<BulkResult> {
  const ids = bulkRowIds(rowIds);
  const database = await requirePageAccess(actor.userId, databaseId, "edit");
  if (database.kind !== "database") throw withCode(new AccessError("Not a database"), "notADatabase");
  if (database.archivedAt) throw withCode(new AccessError("Parent page is in the trash"), "parentInTrash");
  const { rows, skipped } = await rowsWithAccess(actor.userId, databaseId, ids, "view");
  const done: string[] = [];
  try {
    for (const row of rows) done.push((await duplicatePage(actor, row.id, copySuffix, { notify: false })).id);
  } finally {
    if (done.length) {
      const collab = getCollab();
      collab.broadcast(`ws:${database.workspaceId}`, "tree");
      collab.broadcast(`db:${databaseId}`, "rows");
    }
  }
  return { done, skipped };
}

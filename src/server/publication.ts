import { randomBytes } from "node:crypto";
import { and, asc, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { databaseProperty, databaseView, page, pagePublication, user, type PageKind, type ViewConfig, type ViewType } from "@/db/schema";
import { applyView, computedValues, isHiddenInView } from "@/lib/properties";
import { holdsPeople } from "@/lib/property-types";
import { accessRank, pageVisibleTo, requirePageAccess } from "@/server/access";
import type { DatabaseProperty } from "@/server/databases";

/**
 * Publish to web: a published page and its live subpages can be read by anyone holding the link
 * (`/s/<token>/…`), without signing in. Managing a publication needs full access to the page;
 * reading one needs only the token.
 *
 * A publication shows only what its publisher can see right now: subpages or rows restricted from
 * them stay private, and it stops working once they lose access to the page or leave.
 */

/** Deepest subpage reachable from a published page; deeper pages are not served. */
const MAX_DEPTH = 32;

export class PublishError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublishError";
  }
}

export async function getPublication(userId: string, pageId: string) {
  await requirePageAccess(userId, pageId, "view");
  const [row] = await db
    .select({ token: pagePublication.token, createdAt: pagePublication.createdAt })
    .from(pagePublication)
    .where(eq(pagePublication.pageId, pageId))
    .limit(1);
  return row ?? null;
}

export async function publishPage(userId: string, pageId: string): Promise<{ token: string }> {
  const p = await requirePageAccess(userId, pageId, "full");
  if (p.archivedAt) throw new PublishError("Pages in the trash can't be published");
  await db
    .insert(pagePublication)
    .values({ pageId, token: randomBytes(32).toString("base64url"), publishedBy: userId })
    .onConflictDoNothing({ target: pagePublication.pageId });
  // Already published (or published concurrently): keep the existing link.
  const [row] = await db
    .select({ token: pagePublication.token })
    .from(pagePublication)
    .where(eq(pagePublication.pageId, pageId))
    .limit(1);
  if (!row) throw new PublishError("Could not publish the page");
  return row;
}

export async function unpublishPage(userId: string, pageId: string): Promise<void> {
  await requirePageAccess(userId, pageId, "full");
  await db.delete(pagePublication).where(eq(pagePublication.pageId, pageId));
}

// ---------------------------------------------------------------------------------------------
// Public reads (no user). Everything below trusts only the token.

export type PublishedCrumb = { id: string; title: string; icon: string | null; kind: PageKind };
export type PublishedChild = { id: string; title: string; icon: string | null; kind: PageKind };
export type PublishedRow = {
  id: string;
  title: string;
  icon: string | null;
  properties: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
};
export type PublishedDatabase = {
  /** Visible columns of the first view, in property order (relations are never published). */
  properties: DatabaseProperty[];
  view: { id: string; name: string; type: ViewType } | null;
  /** Live rows, filtered and sorted by the first view. */
  rows: PublishedRow[];
};
export type PublishedPage = {
  token: string;
  rootId: string;
  id: string;
  title: string;
  icon: string | null;
  kind: PageKind;
  updatedAt: Date;
  /** Body HTML serialized by BlockNote from the page's own document (see published-body.ts). */
  bodyHtml: string;
  /** From the published page down to this page, both included. */
  crumbs: PublishedCrumb[];
  /** Live subpages (not database rows), in sidebar order. */
  children: PublishedChild[];
  /** Database pages. */
  database: PublishedDatabase | null;
  /** Database rows: their values, with the database's (non-relation) properties. */
  row: { properties: DatabaseProperty[]; values: Record<string, unknown> } | null;
};

/**
 * The published page for `token`, or — with `pageId` — that page if it is a live descendant of
 * the published page. Null when the token is unknown, the published page is in the trash, or
 * `pageId` is outside the published subtree.
 */
export async function getPublishedPage(token: string, pageId?: string): Promise<PublishedPage | null> {
  if (!token || token.length > 128) return null;
  const [root] = await db
    .select({ id: page.id, publishedBy: pagePublication.publishedBy })
    .from(pagePublication)
    .innerJoin(page, eq(page.id, pagePublication.pageId))
    .where(and(eq(pagePublication.token, token), isNull(page.archivedAt)))
    .limit(1);
  if (!root?.publishedBy) return null;
  const publisher = root.publishedBy;

  const targetId = pageId ?? root.id;
  const crumbs = await chainTo(publisher, targetId, root.id);
  if (!crumbs) return null;

  const [target] = await db
    .select({
      id: page.id,
      title: page.title,
      icon: page.icon,
      kind: page.kind,
      parentId: page.parentId,
      properties: page.properties,
      ydoc: page.ydoc,
      updatedAt: page.updatedAt,
    })
    .from(page)
    .where(and(eq(page.id, targetId), isNull(page.archivedAt)))
    .limit(1);
  if (!target) return null;

  const parent = target.parentId
    ? (
        await db
          .select({ kind: page.kind })
          .from(page)
          .where(eq(page.id, target.parentId))
          .limit(1)
      )[0]
    : undefined;

  const { bodyHtmlFromYdoc } = await import("@/server/published-body");
  const [bodyHtml, children, database, rowProperties] = await Promise.all([
    target.kind === "page" ? bodyHtmlFromYdoc(target.ydoc) : Promise.resolve(""),
    target.kind === "database" ? Promise.resolve([]) : liveChildren(publisher, target.id),
    target.kind === "database" ? publishedDatabase(publisher, target.id) : Promise.resolve(null),
    parent?.kind === "database" && target.parentId ? publicProperties(target.parentId) : Promise.resolve(null),
  ]);

  return {
    token,
    rootId: root.id,
    id: target.id,
    title: target.title,
    icon: target.icon,
    kind: target.kind,
    updatedAt: target.updatedAt,
    bodyHtml,
    crumbs,
    children,
    database,
    row: rowProperties ? { properties: rowProperties, values: target.properties } : null,
  };
}

/**
 * Pages from `rootId` down to `pageId` when every page on the way is live and visible to the
 * publisher, and `pageId` lies within MAX_DEPTH levels under the root; null otherwise.
 */
async function chainTo(publisher: string, pageId: string, rootId: string): Promise<PublishedCrumb[] | null> {
  const rows = await db.execute<{
    id: string;
    title: string;
    icon: string | null;
    kind: PageKind;
    archived: boolean;
    visible: boolean;
    depth: number;
  }>(sql`
    with recursive chain as (
      select id, parent_id, title, icon, kind, archived_at is not null as archived, 0 as depth
      from ${page} where id = ${pageId}
      union all
      select p.id, p.parent_id, p.title, p.icon, p.kind, p.archived_at is not null, c.depth + 1
      from ${page} p join chain c on p.id = c.parent_id
      where c.id <> ${rootId} and c.depth < ${MAX_DEPTH}
    )
    select id, title, icon, kind, archived, ${accessRank(publisher, sql`id`)} > 0 as visible, depth
    from chain order by depth desc
  `);
  const list = [...rows];
  if (!list.length || list[0].id !== rootId || list.some((r) => r.archived || !r.visible)) return null;
  return list.map((r) => ({ id: r.id, title: r.title, icon: r.icon, kind: r.kind }));
}

async function liveChildren(publisher: string, parentId: string): Promise<PublishedChild[]> {
  return db
    .select({ id: page.id, title: page.title, icon: page.icon, kind: page.kind })
    .from(page)
    .where(and(eq(page.parentId, parentId), isNull(page.archivedAt), pageVisibleTo(publisher)))
    .orderBy(asc(page.position), asc(page.createdAt));
}

/**
 * A database's properties minus relations, whose values point at pages that may not be published,
 * and people, who didn't agree to have their names on a public page.
 */
async function publicProperties(databaseId: string) {
  return db
    .select()
    .from(databaseProperty)
    .where(and(eq(databaseProperty.databaseId, databaseId), notInArray(databaseProperty.type, ["relation", "person", "created_by"])))
    .orderBy(asc(databaseProperty.position), asc(databaseProperty.createdAt));
}

/**
 * Names of the people a view sorts rows by. They only order the rows: people properties aren't
 * published, so the names never reach the page.
 */
async function sortNames(rows: { properties: Record<string, unknown> }[], props: DatabaseProperty[], config: ViewConfig) {
  const sortedBy = props.filter((p) => holdsPeople(p.type) && config.sorts?.some((s) => s.propertyId === p.id));
  const ids = [...new Set(rows.flatMap((row) => sortedBy.flatMap((p) => row.properties[p.id]).filter((v) => typeof v === "string")))];
  return ids.length ? db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, ids as string[])) : [];
}

async function publishedDatabase(publisher: string, databaseId: string): Promise<PublishedDatabase> {
  const [properties, [view], stored] = await Promise.all([
    publicProperties(databaseId),
    db
      .select()
      .from(databaseView)
      .where(eq(databaseView.databaseId, databaseId))
      .orderBy(asc(databaseView.position), asc(databaseView.createdAt))
      .limit(1),
    db
      .select({
        id: page.id,
        title: page.title,
        icon: page.icon,
        properties: page.properties,
        createdBy: page.createdBy,
        createdAt: page.createdAt,
        updatedAt: page.updatedAt,
      })
      .from(page)
      .where(and(eq(page.parentId, databaseId), isNull(page.archivedAt), pageVisibleTo(publisher)))
      .orderBy(asc(page.position), asc(page.createdAt)),
  ]);
  if (!view) return { properties, view: null, rows: stored.map(({ createdBy: _, ...row }) => row) };
  // Filters and sorts may use relation and people properties; applyView needs every property for that.
  const allProperties = await db.select().from(databaseProperty).where(eq(databaseProperty.databaseId, databaseId));
  const rows = stored.map(({ createdBy, ...row }) => ({
    ...row,
    properties: { ...row.properties, ...computedValues(allProperties, { createdBy }) },
  }));
  return {
    properties: properties.filter((prop) => !isHiddenInView({ type: "table", config: view.config }, prop)),
    view: { id: view.id, name: view.name, type: view.type },
    rows: applyView(rows, view.config, allProperties, { people: await sortNames(rows, allProperties, view.config) }),
  };
}

import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { databaseProperty, databaseView, page, pagePublication, user, type PageKind, type ViewConfig, type ViewType } from "@/db/schema";
import { withFormulaTypes } from "@/lib/derived";
import type { EmbedBlockType, LinkedView } from "@/lib/embed-blocks";
import { applyView, computedValues, isHiddenInView } from "@/lib/properties";
import { holdsPeople } from "@/lib/property-types";
import { AccessError, accessRank, pageVisibleTo, requireMembership, requirePageAccess } from "@/server/access";
import type { DatabaseProperty } from "@/server/databases";
import { computeDerived } from "@/server/derived";
import { canPublish } from "@/server/workspaces";

/**
 * Publish to web: a published page and its live subpages can be read by anyone holding the link
 * (`/s/<token>/…`), without signing in. Publishing needs full access to the page and the
 * workspace's publishing policy (`canPublish`); unpublishing needs full access, and owners can take
 * any page of their workspace offline. Reading one needs only the token.
 *
 * A publication shows only what its publisher can see right now: subpages or rows restricted from
 * them stay private, and it stops working once they lose access to the page or leave.
 */

/** Deepest subpage reachable from a published page; deeper pages are not served. */
const MAX_DEPTH = 32;

export class PublishError extends Error {
  constructor(
    message: string,
    readonly code?: "notAllowed",
  ) {
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

/** Why the user can't publish this page, or null when they can. */
export async function publishBlocker(userId: string, pageId: string): Promise<"needsFullAccess" | "notAllowed" | null> {
  let p;
  try {
    p = await requirePageAccess(userId, pageId, "full");
  } catch (error) {
    if (error instanceof AccessError) return "needsFullAccess";
    throw error;
  }
  return (await canPublish(userId, p.workspaceId)) ? null : "notAllowed";
}

export async function publishPage(userId: string, pageId: string): Promise<{ token: string }> {
  const p = await requirePageAccess(userId, pageId, "full");
  if (!(await canPublish(userId, p.workspaceId))) {
    throw new PublishError("This workspace lets only owners publish pages", "notAllowed");
  }
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

export type WorkspacePublication = {
  pageId: string;
  /** Null when the owner can't see the page: they may take it offline, not read it. */
  title: string | null;
  icon: string | null;
  /** Site path, only for pages the owner can see (the link would show the page to them) and that are still served. */
  url: string | null;
  inTrash: boolean;
  publishedBy: string | null;
  createdAt: Date;
};

/** Every published page of the workspace, newest first, for owners to review. */
export async function listWorkspacePublications(userId: string, workspaceId: string): Promise<WorkspacePublication[]> {
  await requireMembership(userId, workspaceId, "owner");
  const rows = await db
    .select({
      pageId: page.id,
      title: page.title,
      icon: page.icon,
      archivedAt: page.archivedAt,
      token: pagePublication.token,
      publishedBy: user.name,
      createdAt: pagePublication.createdAt,
      visible: sql<boolean>`${accessRank(userId, sql`${page.id}`)} > 0`,
    })
    .from(pagePublication)
    .innerJoin(page, eq(page.id, pagePublication.pageId))
    .leftJoin(user, eq(user.id, pagePublication.publishedBy))
    .where(eq(page.workspaceId, workspaceId))
    .orderBy(desc(pagePublication.createdAt));
  return rows.map((r) => ({
    pageId: r.pageId,
    title: r.visible ? r.title : null,
    icon: r.visible ? r.icon : null,
    url: r.visible && !r.archivedAt ? `/s/${r.token}` : null,
    inTrash: r.archivedAt !== null,
    publishedBy: r.publishedBy,
    createdAt: r.createdAt,
  }));
}

/** Takes a page of the workspace offline, whoever published it. Owners only. */
export async function revokePublication(userId: string, workspaceId: string, pageId: string): Promise<void> {
  await requireMembership(userId, workspaceId, "owner");
  const inWorkspace = db.select({ id: page.id }).from(page).where(and(eq(page.id, pageId), eq(page.workspaceId, workspaceId)));
  await db.delete(pagePublication).where(and(eq(pagePublication.pageId, pageId), inArray(pagePublication.pageId, inWorkspace)));
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
/** A part of a published page's body: text, or a database block. */
export type PublishedBlock =
  | { kind: "html"; html: string }
  | {
      kind: "embed";
      type: EmbedBlockType;
      /**
       * The database, when it is published with this page (it lies under the published page, is
       * live and its publisher can see it). Null otherwise: the block then shows nothing about it.
       */
      database: { id: string; title: string; icon: string | null; table: PublishedDatabase } | null;
    };
export type PublishedPage = {
  token: string;
  rootId: string;
  id: string;
  title: string;
  icon: string | null;
  kind: PageKind;
  updatedAt: Date;
  /** Body HTML serialized by BlockNote from the page's own document (see published-body.ts), with its database blocks. */
  body: PublishedBlock[];
  /** From the published page down to this page, both included. */
  crumbs: PublishedCrumb[];
  /** Live subpages (not database rows, nor inline databases the body shows), in sidebar order. */
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
      createdAt: page.createdAt,
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

  const [body, children, database, rowProperties] = await Promise.all([
    target.kind === "page" ? publishedBody(publisher, root.id, target.ydoc) : Promise.resolve([]),
    target.kind === "database" ? Promise.resolve([]) : liveChildren(publisher, target.id),
    target.kind === "database" ? publishedDatabase(publisher, target.id) : Promise.resolve(null),
    parent?.kind === "database" && target.parentId ? databaseProperties(target.parentId) : Promise.resolve(null),
  ]);
  // Public properties hold no people, so only the created and last edited times are filled in.
  const [row] = rowProperties
    ? await publicValues([{ ...target, properties: { ...target.properties, ...computedValues(rowProperties, { createdBy: null, ...target }) } }], rowProperties)
    : [];

  return {
    token,
    rootId: root.id,
    id: target.id,
    title: target.title,
    icon: target.icon,
    kind: target.kind,
    updatedAt: target.updatedAt,
    body,
    crumbs,
    // An inline database shown in the body isn't listed again below it.
    children: children.filter(
      (child) => !body.some((b) => b.kind === "embed" && b.type === "database" && b.database?.id === child.id),
    ),
    database,
    row: rowProperties ? { properties: publicProperties(rowProperties), values: row.properties } : null,
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

/**
 * The page body with its database blocks resolved. A block's database is shown only when it is
 * published with this page, i.e. reachable from the published page like any of its subpages: an
 * inline database under the page is, a linked view of a database elsewhere is not.
 */
async function publishedBody(publisher: string, rootId: string, ydoc: Uint8Array | null): Promise<PublishedBlock[]> {
  const { bodySegmentsFromYdoc } = await import("@/server/published-body");
  const segments = await bodySegmentsFromYdoc(ydoc);
  return Promise.all(
    segments.map(async (segment): Promise<PublishedBlock> => {
      if (segment.kind === "html") return segment;
      return { kind: "embed", type: segment.type, database: await publishedEmbed(publisher, rootId, segment.databaseId, segment.view) };
    }),
  );
}

async function publishedEmbed(publisher: string, rootId: string, databaseId: string, view: LinkedView | null) {
  const [target] = await db
    .select({ id: page.id, title: page.title, icon: page.icon, kind: page.kind })
    .from(page)
    .where(and(eq(page.id, databaseId), isNull(page.archivedAt)))
    .limit(1);
  if (target?.kind !== "database") return null;
  if (!(await chainTo(publisher, target.id, rootId))) return null;
  return { id: target.id, title: target.title, icon: target.icon, table: await publishedDatabase(publisher, target.id, view) };
}

async function liveChildren(publisher: string, parentId: string): Promise<PublishedChild[]> {
  return db
    .select({ id: page.id, title: page.title, icon: page.icon, kind: page.kind })
    .from(page)
    .where(and(eq(page.parentId, parentId), isNull(page.archivedAt), pageVisibleTo(publisher)))
    .orderBy(asc(page.position), asc(page.createdAt));
}

/** A database's properties in order, with formula result types (see databases.getProperties). */
async function databaseProperties(databaseId: string) {
  const properties = await db
    .select()
    .from(databaseProperty)
    .where(eq(databaseProperty.databaseId, databaseId))
    .orderBy(asc(databaseProperty.position), asc(databaseProperty.createdAt));
  return withFormulaTypes(properties);
}

const PRIVATE_TYPES = new Set<string>(["relation", "rollup", "person", "created_by", "last_edited_by"]);

/**
 * The properties a published page shows: all but relations, whose values point at pages that may
 * not be published (rollups, which calculate over them, go too), and people, who didn't agree to
 * have their names on a public page.
 */
function publicProperties(properties: DatabaseProperty[]) {
  return properties.filter((p) => !PRIVATE_TYPES.has(p.type));
}

/**
 * Rows with their formulas worked out for a public page: formulas that show people or related
 * rows get no names or titles, so nothing private reaches the page through them.
 */
function publicValues<R extends { title: string; properties: Record<string, unknown> }>(rows: R[], properties: DatabaseProperty[]) {
  return computeDerived(rows, properties, { lookups: async () => ({}), viewerId: null });
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

/**
 * A published database's rows as its first view shows them, or as `linked` (a linked view's own
 * settings) does.
 */
async function publishedDatabase(publisher: string, databaseId: string, linked: LinkedView | null = null): Promise<PublishedDatabase> {
  const [allProperties, [firstView], stored] = await Promise.all([
    databaseProperties(databaseId),
    linked
      ? Promise.resolve([])
      : // A form shows no rows, so the page shows the first view that does.
        db
          .select()
          .from(databaseView)
          .where(and(eq(databaseView.databaseId, databaseId), ne(databaseView.type, "form")))
          .orderBy(asc(databaseView.position), asc(databaseView.createdAt))
          .limit(1),
    db
      .select({
        id: page.id,
        title: page.title,
        icon: page.icon,
        properties: page.properties,
        createdBy: page.createdBy,
        updatedBy: page.updatedBy,
        createdAt: page.createdAt,
        updatedAt: page.updatedAt,
      })
      .from(page)
      .where(and(eq(page.parentId, databaseId), isNull(page.archivedAt), pageVisibleTo(publisher)))
      .orderBy(asc(page.position), asc(page.createdAt)),
  ]);
  const properties = publicProperties(allProperties);
  const view = linked ? { id: "", name: "", ...linked } : firstView;
  if (!view) {
    const rows = await publicValues(
      stored.map(({ createdBy: _, updatedBy: __, ...row }) => ({
        ...row,
        properties: { ...row.properties, ...computedValues(allProperties, { createdBy: null, ...row }) },
      })),
      allProperties,
    );
    return { properties, view: null, rows };
  }
  // Filters and sorts may use relation and people properties; applyView needs every property for that.
  // Grouping is left out: published pages show every view as one flat table (boards too), since
  // groups by people or linked rows would name what the page doesn't publish. The columns are the
  // ones the view itself shows, so a list or timeline never publishes what it keeps hidden.
  const rows = await publicValues(
    stored.map(({ createdBy, updatedBy, ...row }) => ({
      ...row,
      properties: { ...row.properties, ...computedValues(allProperties, { createdBy, updatedBy, ...row }) },
    })),
    allProperties,
  );
  return {
    properties: properties.filter((prop) => !isHiddenInView(view, prop)),
    view: { id: view.id, name: view.name, type: view.type },
    rows: applyView(rows, view.config, allProperties, { people: await sortNames(rows, allProperties, view.config) }),
  };
}

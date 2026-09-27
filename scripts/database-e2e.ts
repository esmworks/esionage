/**
 * End-to-end check of database edits against the database: deleting options clears them from rows,
 * stale relation links don't block edits, properties added later start hidden on calendars, a
 * trashed database still lists the rows trashed with it, and the page header knows guests.
 * Creates its own users and workspace and deletes them afterwards.
 *
 *   pnpm tsx scripts/database-e2e.ts
 *
 * Env: DATABASE_URL (read from .env when present). Migrations must be applied.
 */
export {};

try {
  process.loadEnvFile();
} catch {}

// Imported after .env is loaded: the database client reads DATABASE_URL when it is created.
const { eq, inArray } = await import("drizzle-orm");
const { db } = await import("@/db");
const { databaseView, page, user, workspace, workspaceMember } = await import("@/db/schema");
const { registerCollab } = await import("@/server/collab/bridge");
const { addProperty, addView, getDatabaseSnapshot, updateProperty, updateRowProperties } = await import(
  "@/server/databases"
);
const { archivePage, createPage, deletePagePermanently } = await import("@/server/pages");
const { getPageHeaderInfo } = await import("@/server/page-meta");

const RUN = `database-e2e-${Date.now().toString(36)}`;

// Writes notify open editors through the collab service, which only runs inside the app server.
registerCollab({ broadcast() {} } as unknown as Parameters<typeof registerCollab>[0]);

let passed = 0;
function check(condition: unknown, label: string, detail?: unknown): asserts condition {
  if (!condition) {
    console.error(`FAIL  ${label}`);
    if (detail !== undefined) console.error(JSON.stringify(detail, null, 2));
    throw new Error(`Check failed: ${label}`);
  }
  passed++;
  console.log(`ok    ${label}`);
}

const ids = { owner: `${RUN}-owner`, guest: `${RUN}-guest` };
const userIds = Object.values(ids);
const workspaceId = `${RUN}-ws`;

async function values(rowId: string) {
  const [row] = await db.select({ properties: page.properties }).from(page).where(eq(page.id, rowId));
  return row.properties;
}

try {
  await db.insert(user).values(userIds.map((id) => ({ id, name: id, email: `${id}@example.test` })));
  await db.insert(workspace).values({ id: workspaceId, name: RUN });
  await db.insert(workspaceMember).values([
    { workspaceId, userId: ids.owner, role: "owner" },
    { workspaceId, userId: ids.guest, role: "guest" },
  ]);
  const actor = { userId: ids.owner };
  const tasks = await createPage(actor, { workspaceId, kind: "database", title: "Tasks" });
  const other = await createPage(actor, { workspaceId, kind: "database", title: "Other" });

  // Deleting options clears them from rows
  const status = await addProperty(ids.owner, tasks.id, { name: "Stage", type: "select", options: ["A", "B"] });
  const tags = await addProperty(ids.owner, tasks.id, { name: "Tags", type: "multi_select", options: ["x", "y"] });
  const [a, b] = status.options.options!;
  const [x, y] = tags.options.options!;
  const r1 = await createPage(actor, { workspaceId, parentId: tasks.id, title: "r1", properties: { [status.id]: "A", [tags.id]: ["x", "y"] } });
  const r2 = await createPage(actor, { workspaceId, parentId: tasks.id, title: "r2", properties: { [status.id]: "B", [tags.id]: ["x"] } });
  await updateProperty(ids.owner, status.id, { options: [b] });
  await updateProperty(ids.owner, tags.id, { options: [y] });
  const [v1, v2] = [await values(r1.id), await values(r2.id)];
  check(!(status.id in v1) && v2[status.id] === b.id, "a deleted select option is cleared from its rows", [v1, v2]);
  check(
    JSON.stringify(v1[tags.id]) === JSON.stringify([y.id]) && !(tags.id in v2),
    "a deleted tag is removed from lists, and an emptied list is cleared",
    [v1, v2],
  );
  check(a.id !== b.id && x.id !== y.id, "options had distinct ids");

  // Stale relation links don't block edits
  const link = await addProperty(ids.owner, tasks.id, { name: "Link", type: "relation", relation: { databaseId: other.id } });
  const o1 = await createPage(actor, { workspaceId, parentId: other.id, title: "o1" });
  const o2 = await createPage(actor, { workspaceId, parentId: other.id, title: "o2" });
  await updateRowProperties(ids.owner, r1.id, { [link.id]: [o1.id] });
  await archivePage(ids.owner, o1.id);
  await deletePagePermanently(ids.owner, o1.id);
  await updateRowProperties(ids.owner, r1.id, { [link.id]: [o1.id, o2.id] });
  check(
    JSON.stringify((await values(r1.id))[link.id]) === JSON.stringify([o2.id]),
    "a link to a deleted row is dropped instead of failing the edit",
    await values(r1.id),
  );

  // Two-way relation to the same database gets two distinct names
  const self = await addProperty(ids.owner, tasks.id, {
    name: "Parent",
    type: "relation",
    relation: { databaseId: tasks.id, twoWay: true, pairedName: "Parent" },
  });
  const names = (await getDatabaseSnapshot(ids.owner, tasks.id)).properties.filter((p) => p.type === "relation");
  const paired = names.find((p) => p.id === self.options.relation?.pairedPropertyId);
  check(paired && paired.name !== self.name, "a two-way self relation doesn't reuse the same name", names);

  // Properties added later start hidden on calendars
  const calendar = await addView(ids.owner, tasks.id, { name: "Cal", type: "calendar" });
  const late = await addProperty(ids.owner, tasks.id, { name: "Late", type: "text" });
  const twoWay = await addProperty(ids.owner, other.id, {
    name: "Tasks",
    type: "relation",
    relation: { databaseId: tasks.id, twoWay: true },
  });
  const [view] = await db.select().from(databaseView).where(eq(databaseView.id, calendar.id));
  const hidden = view.config.hidden ?? [];
  check(hidden.includes(late.id), "a property added after the calendar view is hidden there", hidden);
  check(
    hidden.includes(twoWay.options.relation!.pairedPropertyId!),
    "…and so is the paired property of a two-way relation added from the other database",
    hidden,
  );

  // A trashed database lists the rows trashed with it
  await archivePage(ids.owner, tasks.id);
  const trashed = await getDatabaseSnapshot(ids.owner, tasks.id);
  check(
    trashed.database.archived && trashed.rows.map((r) => r.title).sort().join() === "r1,r2",
    "a trashed database still shows its rows",
    trashed.rows,
  );

  // The page header tells guests apart
  check((await getPageHeaderInfo(ids.owner, other.id)).guest === false, "the header marks members as not guests");
  await db.update(page).set({ parentId: null }).where(inArray(page.id, [other.id]));
  const { setPagePermission } = await import("@/server/permissions");
  await setPagePermission(ids.owner, other.id, ids.guest, "view");
  check((await getPageHeaderInfo(ids.guest, other.id)).guest === true, "…and guests as guests");

  console.log(`\n${passed} checks passed`);
} finally {
  await db.delete(workspace).where(inArray(workspace.id, [workspaceId]));
  await db.delete(user).where(inArray(user.id, userIds));
  await (globalThis as unknown as { __esionageSql?: { end(): Promise<void> } }).__esionageSql?.end();
}

/**
 * End-to-end check of property access ("who can see and change this column") against the
 * database: an owner with full access restricts Salary; people with edit access then don't see
 * its values (or, at "none", the property at all) in the snapshot, row pages, listRows, MCP row
 * values, formulas over it, rollups over it from another database, filters and sorts; can't write
 * it, drag a board card across it, rename or delete it; exceptions for a person, a group and a
 * person property of the row raise the level (never past the database access); saving a view
 * keeps the owner's filter on a column the saver can't see; removing the restriction brings
 * everything back; and changes land in the audit log.
 * Creates its own users and workspace and deletes them afterwards.
 *
 *   pnpm tsx scripts/property-access-e2e.ts
 *
 * Env: DATABASE_URL (read from .env when present). Migrations must be applied.
 */
export {};

try {
  process.loadEnvFile();
} catch {}

// Imported after .env is loaded: the database client reads DATABASE_URL when it is created.
const { and, eq, inArray } = await import("drizzle-orm");
const { db } = await import("@/db");
const { auditEvent, databaseView, page, propertyPermission, user, workspace, workspaceMember } = await import("@/db/schema");
const { registerCollab } = await import("@/server/collab/bridge");
const databases = await import("@/server/databases");
const { createPage } = await import("@/server/pages");
const { setPagePermission } = await import("@/server/permissions");
const { createGroup } = await import("@/server/groups");
const { getPropertyAccessSettings, setPropertyAccess } = await import("@/server/property-access");
const ops = await import("@/server/operations");
const { databaseCsv } = await import("@/server/export");
const { PropertyValueError } = await import("@/lib/properties");
const { AccessError } = await import("@/server/access");

const RUN = `propaccess-e2e-${Date.now().toString(36)}`;

registerCollab({
  broadcast: () => {},
  async disconnectLostAccess() {},
} as unknown as Parameters<typeof registerCollab>[0]);

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

async function refused(write: Promise<unknown>, code?: string) {
  return write.then(
    () => false,
    (error: unknown) => {
      if (process.env.DEBUG_E2E) console.error(error);
      return (error instanceof PropertyValueError && (!code || error.code === code)) || (!code && error instanceof AccessError);
    },
  );
}

const ids = { owner: `${RUN}-owner`, editor: `${RUN}-editor`, hr: `${RUN}-hr`, grouped: `${RUN}-grouped`, viewer: `${RUN}-viewer` };
const workspaceId = `${RUN}-ws`;
const has = (o: object, key: string) => Object.hasOwn(o, key);

try {
  await db.insert(user).values(Object.values(ids).map((id) => ({ id, name: id.split("-").at(-1)!, email: `${id}@example.test` })));
  await db.insert(workspace).values({ id: workspaceId, name: RUN });
  await db.insert(workspaceMember).values([
    { workspaceId, userId: ids.owner, role: "owner" },
    ...[ids.editor, ids.hr, ids.grouped, ids.viewer].map((userId) => ({ workspaceId, userId, role: "member" as const })),
  ]);
  const actor = { userId: ids.owner };
  const staff = await createPage(actor, { workspaceId, kind: "database", title: "Staff" });
  const teams = await createPage(actor, { workspaceId, kind: "database", title: "Teams" });
  const salary = await databases.addProperty(ids.owner, staff.id, { name: "Salary", type: "number" });
  const notes = await databases.addProperty(ids.owner, staff.id, { name: "Notes", type: "text" });
  const secret = await databases.addProperty(ids.owner, staff.id, { name: "Secret", type: "text" });
  const manager = await databases.addProperty(ids.owner, staff.id, { name: "Manager", type: "person" });
  const level = await databases.addProperty(ids.owner, staff.id, { name: "Level", type: "select", options: [{ name: "A" }, { name: "B" }] });
  const yearly = await databases.addProperty(ids.owner, staff.id, { name: "Yearly", type: "formula", formula: { expression: 'prop("Salary") * 12' } });
  // Members get what they are given here, not the workspace-wide default.
  for (const id of [staff.id, teams.id]) {
    await setPagePermission(ids.owner, id, ids.owner, "full");
    await setPagePermission(ids.owner, id, null, "none");
  }
  for (const userId of [ids.editor, ids.hr, ids.grouped]) await setPagePermission(ids.owner, staff.id, userId, "edit");
  await setPagePermission(ids.owner, staff.id, ids.viewer, "view");

  const ada = await createPage(actor, {
    workspaceId,
    parentId: staff.id,
    title: "Ada",
    properties: { Salary: 123456, Notes: "n1", Secret: "SECRETVALUE1", Manager: [ids.editor], Level: "A" },
  });
  const bob = await createPage(actor, {
    workspaceId,
    parentId: staff.id,
    title: "Bob",
    properties: { Salary: 654321, Notes: "n2", Secret: "SECRETVALUE2", Manager: [ids.hr], Level: "B" },
  });

  // A second database rolls up Salary through a relation.
  const members = await databases.addProperty(ids.owner, teams.id, { name: "Members", type: "relation", relation: { databaseId: staff.id } });
  const total = await databases.addProperty(ids.owner, teams.id, {
    name: "Total",
    type: "rollup",
    rollup: { relationPropertyId: members.id, targetPropertyId: salary.id, function: "sum" },
  });
  await setPagePermission(ids.owner, teams.id, ids.editor, "edit");
  const team = await createPage(actor, { workspaceId, parentId: teams.id, title: "Core", properties: { Members: [ada.id, bob.id] } });

  // Before any rule, everyone sees everything.
  const before = await databases.getDatabaseSnapshot(ids.editor, staff.id);
  check(before.propertyAccess === undefined, "no rules: nothing is restricted");
  check(before.rows.find((r) => r.id === ada.id)?.properties[salary.id] === 123456, "no rules: values show");

  const { pageAccessOf } = await import("@/server/access");
  check((await pageAccessOf(ids.editor, staff.id)).level === "edit" && (await pageAccessOf(ids.owner, staff.id)).level === "full", "set up: editor edits, owner has full access");
  // Only the owner (full access) may set access.
  const g = await createGroup(ids.owner, workspaceId, `${RUN} HR`, [ids.grouped]);
  check(
    await refused(setPropertyAccess(ids.editor, salary.id, { everyone: "none", exceptions: [] })),
    "someone without full access can't restrict a property",
  );
  check(
    await refused(setPropertyAccess(ids.owner, members.id, { everyone: "none", exceptions: [] }), "cannotRestrict"),
    "relations can't be restricted",
  );
  await setPropertyAccess(ids.owner, salary.id, {
    everyone: "view_property",
    exceptions: [
      { userId: ids.hr, level: "edit" },
      { groupId: g.id, level: "view" },
      { personPropertyId: manager.id, level: "edit_values" },
    ],
  });
  await setPropertyAccess(ids.owner, secret.id, { everyone: "none", exceptions: [] });
  const settings = await getPropertyAccessSettings(ids.owner, salary.id);
  check(settings.everyone === "view_property" && settings.exceptions.length === 3, "settings read back", settings);

  // The editor: Salary shows as a column, its values only in rows naming them as manager.
  const snap = await databases.getDatabaseSnapshot(ids.editor, staff.id);
  check(!snap.properties.some((p) => p.id === secret.id), "a property at none is not in the schema");
  check(snap.propertyAccess?.[salary.id]?.level === "edit_values" && snap.propertyAccess[salary.id].perRow, "salary: per-row level", snap.propertyAccess);
  const adaRow = snap.rows.find((r) => r.id === ada.id)!;
  const bobRow = snap.rows.find((r) => r.id === bob.id)!;
  check(adaRow.properties[salary.id] === 123456 && adaRow.properties[yearly.id] === 123456 * 12, "own managed row shows salary and the formula over it", adaRow);
  check(!has(bobRow.properties, salary.id) && bobRow.hidden?.includes(salary.id), "other rows hide salary", bobRow);
  check(!has(bobRow.properties, yearly.id) && bobRow.hidden?.includes(yearly.id), "a formula over a hidden value is hidden too", bobRow);
  check(!has(bobRow.properties, secret.id) && !has(adaRow.properties, secret.id) && !bobRow.hidden?.includes(secret.id), "a none value is gone without a trace");
  check(!/SECRETVALUE|654321/.test(JSON.stringify(snap)), "the snapshot carries neither value anywhere");

  // Row page and MCP-style row values.
  const bobPage = await databases.getRow(ids.editor, bob.id);
  check(!has(bobPage.row.properties, salary.id) && !bobPage.properties.some((p) => p.id === secret.id), "row page redacts too", bobPage.row);
  const [bobStored] = await db.select().from(page).where(eq(page.id, bob.id));
  const values = await databases.rowValues(ids.editor, bobStored, bobPage.properties);
  check(!has(values, salary.id) && !has(values, secret.id), "rowValues redacts even with a short property list", values);

  // Filters and sorts on hidden values say nothing about them.
  const filtered = await databases.listRows(ids.editor, staff.id, { filters: [{ propertyId: salary.id, op: "gt", value: 200000 }] });
  check(!filtered.some((r) => r.id === bob.id), "a filter on hidden values can't find Bob's salary", filtered.map((r) => r.title));
  const bySecret = await databases.listRows(ids.editor, staff.id, { filters: [{ propertyId: secret.id, op: "equals", value: "SECRETVALUE2" }] });
  check(bySecret.length === 2, "a filter on a none property doesn't apply", bySecret.map((r) => r.title));

  // Rollup in another database over the restricted Salary.
  const teamRow = await databases.getRow(ids.editor, team.id);
  check(!has(teamRow.row.properties, total.id), "a rollup over a property the viewer can't view shows nothing", teamRow.row.properties);
  const teamOwner = await databases.getRow(ids.owner, team.id);
  check(teamOwner.row.properties[total.id] === 777777, "the owner's rollup is whole", teamOwner.row.properties);

  // What MCP tools, the REST API and exports hand out (they share these operations).
  const ctx = { userId: ids.editor, actor: { userId: ids.editor } };
  const leaks = (label: string, out: unknown) =>
    check(!/SECRETVALUE|654321|"Secret"/.test(JSON.stringify(out)), `${label} carries no hidden value or unknown property`, out);
  leaks("get_database", await ops.getDatabase(ctx, { database_id: staff.id }));
  leaks("query_database", await ops.queryDatabase(ctx, { database_id: staff.id, limit: 50 }));
  leaks("a row as MCP shows it", await ops.getDatabaseRow(ctx, { row_id: bob.id }));
  leaks("CSV export", await databaseCsv(ids.editor, staff.id));
  const csvOwner = await databaseCsv(ids.owner, staff.id);
  check(JSON.stringify(csvOwner).includes("654321"), "the owner's export is whole");
  check(
    await ops.setPropertyAccess(ctx, { database_id: staff.id, property: "Notes", everyone: "none", exceptions: [] }).then(
      () => false,
      () => true,
    ),
    "set_property_access needs full access",
  );

  // Writes.
  check(await refused(databases.updateRowProperties(ids.editor, bob.id, { Salary: 1 }), "propertyRestricted"), "can't write a hidden value");
  check(!(await refused(databases.updateRowProperties(ids.editor, ada.id, { Salary: 110 }))), "can write where the person exception allows");
  check(await refused(databases.updateRowProperties(ids.editor, bob.id, { Secret: "x" }), "unknownProperty"), "a none property is unknown");
  const bulk = await databases.updateRowsProperties(ids.editor, staff.id, [ada.id, bob.id], { Salary: 5 });
  check(bulk.done.length === 1 && bulk.done[0] === ada.id && bulk.skipped.includes(bob.id), "bulk edits skip rows it may not change", bulk);
  check(await refused(databases.updateProperty(ids.editor, salary.id, { name: "Pay" }), "propertyRestricted"), "can't rename it");
  check(await refused(databases.deleteProperty(ids.editor, salary.id), "propertyRestricted"), "can't delete it");
  check(await refused(databases.deleteProperty(ids.editor, secret.id)), "can't delete a property it can't see");
  check(
    await refused(databases.createRows(ids.editor, staff.id, [{ title: "New", properties: { Salary: 9 } }]), "propertyRestricted"),
    "can't set it on a new row",
  );
  check(
    await refused(databases.addProperty(ids.editor, staff.id, { name: "Leak", type: "formula", formula: { expression: 'prop("Secret")' } })),
    "a formula can't name a property the author can't know of",
  );

  // The HR person edits everything about it; the group member sees values; the viewer is capped.
  const hr = await databases.getDatabaseSnapshot(ids.hr, staff.id);
  check(hr.propertyAccess?.[salary.id]?.level === "edit" && hr.rows.every((r) => has(r.properties, salary.id)), "person exception: edit", hr.propertyAccess);
  await databases.updateProperty(ids.hr, salary.id, { name: "Salary" });
  const grouped = await databases.getDatabaseSnapshot(ids.grouped, staff.id);
  // The level shown for the column is the most any row gives (the manager exception could give values).
  check(grouped.rows.every((r) => has(r.properties, salary.id) && r.readOnly?.includes(salary.id)), "group exception: view", grouped.rows);
  check(await refused(databases.updateRowProperties(ids.grouped, ada.id, { Salary: 1 }), "propertyRestricted"), "view can't write");
  await setPropertyAccess(ids.owner, salary.id, { everyone: "view_property", exceptions: [{ userId: ids.viewer, level: "edit" }] });
  const viewer = await databases.getDatabaseSnapshot(ids.viewer, staff.id);
  check(viewer.propertyAccess?.[salary.id]?.level === "view", "no exception goes past database access", viewer.propertyAccess);

  // Board drag across a hidden property is a write.
  await setPropertyAccess(ids.owner, level.id, { everyone: "view", exceptions: [] });
  const option = level.options.options!.find((o) => o.name === "B")!;
  check(
    await refused(databases.moveRow(ids.editor, ada.id, { groupBy: level.id, groupValue: option.id }), "propertyRestricted"),
    "a board drag can't change a read-only value",
  );

  // Saving a view keeps the owner's references to a property the saver can't see.
  const [view] = await db.select().from(databaseView).where(eq(databaseView.databaseId, staff.id));
  await databases.updateView(ids.owner, view.id, {
    config: { sorts: [{ propertyId: secret.id, direction: "asc" }], filters: [{ propertyId: secret.id, op: "is_not_empty" }], hidden: [notes.id] },
  });
  const seen = await databases.getDatabase(ids.editor, staff.id);
  const seenView = seen.views.find((v) => v.id === view.id)!;
  check(!JSON.stringify(seenView.config).includes(secret.id), "the editor's copy of the view doesn't mention the none property", seenView.config);
  const saved = await databases.updateView(ids.editor, view.id, { config: { ...seenView.config, hidden: [] } });
  check(!JSON.stringify(saved.config).includes(secret.id), "the saved view comes back without it");
  const [stored] = await db.select().from(databaseView).where(eq(databaseView.id, view.id));
  check(
    stored.config.sorts?.[0]?.propertyId === secret.id && JSON.stringify(stored.config.filters).includes(secret.id) && !stored.config.hidden?.length,
    "the owner's sort and filter survive the editor's save",
    stored.config,
  );

  // Full access is never restricted, and "inherit" lifts the restriction.
  const full = await databases.getDatabaseSnapshot(ids.owner, staff.id);
  check(full.propertyAccess === undefined && full.properties.some((p) => p.id === secret.id), "full access sees everything");
  await setPropertyAccess(ids.owner, secret.id, { everyone: "inherit", exceptions: [] });
  const lifted = await databases.getDatabaseSnapshot(ids.editor, staff.id);
  check(lifted.rows.find((r) => r.id === bob.id)?.properties[secret.id] === "SECRETVALUE2", "inherit brings the values back");
  const left = await db.select().from(propertyPermission).where(eq(propertyPermission.propertyId, secret.id));
  check(left.length === 0, "inherit leaves no entries behind");

  // Deleting the person property drops its exception with it.
  await databases.deleteProperty(ids.owner, manager.id);
  const [after] = (await getPropertyAccessSettings(ids.owner, salary.id)).exceptions.filter((e) => e.kind === "person");
  check(!after, "an exception goes with its person property");

  const events = await db
    .select()
    .from(auditEvent)
    .where(and(eq(auditEvent.workspaceId, workspaceId), eq(auditEvent.action, "property.access_changed")));
  check(events.length >= 4, "changes are in the audit log", events.length);

  console.log(`\n${passed} checks passed`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await db.delete(page).where(eq(page.workspaceId, workspaceId));
  await db.delete(workspace).where(eq(workspace.id, workspaceId));
  await db.delete(user).where(inArray(user.id, Object.values(ids)));
  process.exit();
}

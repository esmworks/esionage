/**
 * End-to-end check of person properties against the database: values resolve from "me", ids,
 * emails and names; guests see only the people already assigned and can't look anyone up;
 * "me" filters show each viewer their own rows; former members keep showing where assigned.
 * Creates its own users and workspace and deletes them afterwards.
 *
 *   pnpm tsx scripts/person-e2e.ts
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
const { page, user, workspace, workspaceMember } = await import("@/db/schema");
const { registerCollab } = await import("@/server/collab/bridge");
const { addProperty, getDatabaseSnapshot, getLookups, getRow, listRows, updateRowProperties } = await import(
  "@/server/databases"
);
const { createPage } = await import("@/server/pages");
const { setPagePermission } = await import("@/server/permissions");
const { PropertyValueError } = await import("@/lib/properties");

const RUN = `person-e2e-${Date.now().toString(36)}`;

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

async function rejects(write: Promise<unknown>) {
  return write.then(
    () => false,
    (error: unknown) => error instanceof PropertyValueError && error.code === "invalidPerson",
  );
}

const ids = { owner: `${RUN}-owner`, member: `${RUN}-member`, guest: `${RUN}-guest`, former: `${RUN}-former`, bystander: `${RUN}-bystander` };
const userIds = Object.values(ids);
const workspaceId = `${RUN}-ws`;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

async function values(rowId: string) {
  const [row] = await db.select({ properties: page.properties }).from(page).where(eq(page.id, rowId));
  return row.properties;
}

try {
  await db.insert(user).values([
    { id: ids.owner, name: "Owner Olcay", email: `${ids.owner}@example.test` },
    { id: ids.member, name: "Member Mert", email: `${ids.member}@example.test` },
    { id: ids.guest, name: "Guest Gül", email: `${ids.guest}@example.test` },
    { id: ids.former, name: "Former Fatma", email: `${ids.former}@example.test` },
    { id: ids.bystander, name: "Bystander Berk", email: `${ids.bystander}@example.test` },
  ]);
  await db.insert(workspace).values({ id: workspaceId, name: RUN });
  await db.insert(workspaceMember).values([
    { workspaceId, userId: ids.owner, role: "owner" },
    { workspaceId, userId: ids.member, role: "member" },
    { workspaceId, userId: ids.guest, role: "guest" },
    { workspaceId, userId: ids.former, role: "member" },
    { workspaceId, userId: ids.bystander, role: "member" },
  ]);
  const actor = { userId: ids.owner };
  const tasks = await createPage(actor, { workspaceId, kind: "database", title: "Tasks" });
  const owner = await addProperty(ids.owner, tasks.id, { name: "Assignee", type: "person" });

  // Values resolve from me, ids, emails and names
  const mine = await createPage(actor, { workspaceId, parentId: tasks.id, title: "mine", properties: { Assignee: ["me"] } });
  check(same((await values(mine.id))[owner.id], [ids.owner]), "\"me\" assigns the writer", await values(mine.id));
  const theirs = await createPage(actor, {
    workspaceId,
    parentId: tasks.id,
    title: "theirs",
    properties: { Assignee: [`${ids.member}@EXAMPLE.test`, "former fatma", ids.member] },
  });
  check(
    same((await values(theirs.id))[owner.id], [ids.member, ids.former]),
    "emails and names resolve to user ids, duplicates dropped",
    await values(theirs.id),
  );
  check(await rejects(updateRowProperties(ids.owner, mine.id, { Assignee: ["someone@else.test"] })), "someone outside the workspace is refused");

  // "me" filters show each viewer their own rows
  const meFilter = { filters: [{ propertyId: owner.id, op: "contains" as const, value: "me" }] };
  const titles = async (userId: string) => (await listRows(userId, tasks.id, meFilter)).map((r) => r.title);
  check(same(await titles(ids.owner), ["mine"]), "the owner's \"me\" view lists the owner's rows");
  check(same(await titles(ids.member), ["theirs"]), "the member's \"me\" view lists the member's rows");

  // Owners and members see everyone; guests only who is assigned
  const snapshot = await getDatabaseSnapshot(ids.owner, tasks.id);
  check(
    snapshot.viewerId === ids.owner && same(snapshot.people.map((p) => p.id).sort(), [...userIds].sort()),
    "the owner's snapshot lists everyone in the workspace",
    snapshot.people,
  );
  check(snapshot.people.every((p) => p.email && p.active), "…with emails, all active");

  await setPagePermission(ids.owner, tasks.id, ids.guest, "edit");
  const guestPeople = (await getDatabaseSnapshot(ids.guest, tasks.id)).people;
  check(
    same(guestPeople.map((p) => p.id).sort(), [ids.former, ids.guest, ids.member, ids.owner].sort()),
    "a guest sees themselves and the people assigned in rows they can see, no one else",
    guestPeople,
  );
  check(
    guestPeople.every((p) => (p.id === ids.guest ? p.email !== null : p.email === null)),
    "…and no one's email but their own",
    guestPeople,
  );
  check(await rejects(updateRowProperties(ids.guest, mine.id, { Assignee: [`${ids.owner}@example.test`] })), "a guest can't look people up by email");
  await updateRowProperties(ids.guest, mine.id, { Assignee: [ids.owner, "me"] });
  check(same((await values(mine.id))[owner.id], [ids.owner, ids.guest]), "…but can assign by id and assign themselves");

  // Former members keep showing where assigned
  await db.delete(workspaceMember).where(and(eq(workspaceMember.workspaceId, workspaceId), eq(workspaceMember.userId, ids.former)));
  const afterLeave = (await getRow(ids.owner, theirs.id)).people;
  const former = afterLeave.find((p) => p.id === ids.former);
  check(former && !former.active && former.name === "Former Fatma", "someone who left shows as inactive where assigned", afterLeave);
  await updateRowProperties(ids.owner, theirs.id, { Assignee: [ids.former, ids.member, "me"] });
  check(
    same((await values(theirs.id))[owner.id], [ids.former, ids.member, ids.owner]),
    "…and keeping them while editing the cell doesn't fail",
  );
  check(
    await rejects(updateRowProperties(ids.owner, mine.id, { Assignee: [ids.former] })),
    "…but they can't be newly assigned",
  );

  // MCP lookups name people for output and filters
  const lookups = await getLookups(ids.member, snapshot.properties);
  check(
    lookups.people.some((p) => p.id === ids.owner && p.name === "Owner Olcay") && same(lookups.relations, {}),
    "MCP lookups carry the people with their names",
    lookups,
  );

  console.log(`\n${passed} checks passed`);
} finally {
  await db.delete(workspace).where(inArray(workspace.id, [workspaceId]));
  await db.delete(user).where(inArray(user.id, userIds));
  await (globalThis as unknown as { __esionageSql?: { end(): Promise<void> } }).__esionageSql?.end();
}

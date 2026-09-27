/**
 * End-to-end check of page permissions against the database: defaults, inheritance, widening and
 * narrowing on subpages, visibility in lists, shared pages showing up as top-level pages, and the
 * guard that keeps someone with full access on every page. Creates its own users and workspace
 * and deletes them afterwards.
 *
 *   pnpm tsx scripts/access-e2e.ts
 *
 * Env: DATABASE_URL (read from .env when present). Migrations must be applied.
 */
export {};

try {
  process.loadEnvFile();
} catch {}

// Imported after .env is loaded: the database client reads DATABASE_URL when it is created.
const { inArray } = await import("drizzle-orm");
const { db } = await import("@/db");
const { page, user, workspace, workspaceMember } = await import("@/db/schema");
const { AccessError, requirePageAccess, resolvePageAccess } = await import("@/server/access");
const { getBreadcrumbs, getTree, listChildren } = await import("@/server/pages");
const { listPagePermissions, PermissionError, removePagePermission, setPagePermission } = await import(
  "@/server/permissions"
);

const RUN = `access-e2e-${Date.now().toString(36)}`;

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

async function rejects(fn: () => Promise<unknown>, test: (error: unknown) => boolean, label: string) {
  try {
    await fn();
  } catch (error) {
    check(test(error), label, String(error));
    return;
  }
  check(false, label, "did not throw");
}

const isCode = (code: string) => (error: unknown) => error instanceof PermissionError && error.code === code;
const isAccessError = (error: unknown) => error instanceof AccessError;

async function levels(pageId: string, ...userIds: string[]) {
  return Promise.all(userIds.map(async (id) => (await resolvePageAccess(id, pageId)).level));
}

const ids = { owner: `${RUN}-owner`, alice: `${RUN}-alice`, bob: `${RUN}-bob`, outsider: `${RUN}-outsider` };
const userIds = Object.values(ids);
const workspaceId = `${RUN}-ws`;

try {
  await db.insert(user).values(userIds.map((id) => ({ id, name: id, email: `${id}@example.test` })));
  await db.insert(workspace).values({ id: workspaceId, name: RUN });
  await db.insert(workspaceMember).values([
    { workspaceId, userId: ids.owner, role: "owner" },
    { workspaceId, userId: ids.alice, role: "member" },
    { workspaceId, userId: ids.bob, role: "member" },
  ]);
  // R ─ C ─ G, and T ─ P
  const P = (id: string, parentId: string | null, position: number) => ({
    id: `${RUN}-${id}`,
    workspaceId,
    parentId: parentId && `${RUN}-${parentId}`,
    title: id,
    position,
  });
  await db.insert(page).values([P("R", null, 1), P("T", null, 2)]);
  await db.insert(page).values([P("C", "R", 1), P("P", "T", 1)]);
  await db.insert(page).values([P("G", "C", 1)]);
  const [R, C, G, T, Pg] = ["R", "C", "G", "T", "P"].map((name) => `${RUN}-${name}`);
  const { owner, alice, bob, outsider } = ids;

  // Defaults
  check(
    JSON.stringify(await levels(G, owner, alice, bob, outsider)) === '["full","full","full","none"]',
    "without entries members get full access, outsiders none",
  );

  // The guard
  await rejects(
    () => setPagePermission(owner, R, null, "view"),
    isCode("lastFullAccess"),
    "restricting everyone without keeping a full-access member is refused",
  );
  check((await levels(R, owner))[0] === "full", "the refused change was rolled back");
  await rejects(() => setPagePermission(owner, R, outsider, "view"), isCode("notMember"), "outsiders can't be added");

  // Inheritance
  await setPagePermission(owner, R, owner, "full");
  await setPagePermission(owner, R, null, "view");
  check(
    JSON.stringify(await levels(G, owner, alice, bob)) === '["full","view","view"]',
    "entries on a page apply to its subpages",
  );
  await setPagePermission(owner, R, null, "edit");
  check((await levels(R, bob))[0] === "edit", "setting everyone again updates the same entry");
  await setPagePermission(owner, R, null, "view");
  await rejects(() => setPagePermission(alice, R, alice, "full"), isAccessError, "view access can't share");
  await rejects(() => requirePageAccess(alice, C, "edit"), isAccessError, "view access can't edit");

  // Widening and narrowing on a subpage
  await setPagePermission(owner, C, alice, "edit");
  check(JSON.stringify(await levels(G, alice, bob)) === '["edit","view"]', "a subpage entry widens one member");
  await setPagePermission(owner, G, null, "none");
  check(
    JSON.stringify(await levels(G, owner, alice, bob)) === '["full","edit","none"]',
    "a subpage entry for everyone narrows it, own entries still apply",
  );
  check((await levels(C, bob))[0] === "view", "narrowing a subpage leaves its parent alone");

  const shared = await listPagePermissions(alice, G);
  check(shared.everyone === "none" && shared.level === "edit", "listing shows the everyone level and the viewer's", shared);
  const aliceEntry = shared.entries.find((e) => e.userId === alice);
  check(aliceEntry?.inherited === true && aliceEntry.sourcePageId === C, "listing marks inherited entries", shared);
  await rejects(() => listPagePermissions(bob, G), isAccessError, "listing needs view access");

  // Visibility in lists
  const bobTree = (await getTree(bob, workspaceId)).map((n) => n.id);
  check(bobTree.includes(C) && !bobTree.includes(G), "the tree hides pages the member can't see", bobTree);

  await setPagePermission(owner, T, owner, "full");
  await setPagePermission(owner, T, null, "none");
  await setPagePermission(owner, Pg, alice, "view");
  const aliceTree = await getTree(alice, workspaceId);
  check(!aliceTree.some((n) => n.id === T), "a private page is hidden from others");
  check(
    aliceTree.find((n) => n.id === Pg)?.parentId === null,
    "a page shared under a hidden parent is top-level in the tree",
    aliceTree,
  );
  const aliceRoots = (await listChildren(alice, workspaceId, null)).map((p) => p.id).sort();
  check(JSON.stringify(aliceRoots) === JSON.stringify([Pg, R].sort()), "…and in the top-level list", aliceRoots);
  const crumbs = (await getBreadcrumbs(alice, Pg)).map((c) => c.id);
  check(JSON.stringify(crumbs) === JSON.stringify([Pg]), "breadcrumbs skip hidden ancestors", crumbs);
  check((await levels(Pg, bob))[0] === "none", "the shared page stays hidden from others");

  // The guard also covers subpages with entries of their own
  await setPagePermission(owner, C, alice, "full");
  await setPagePermission(owner, G, owner, "view");
  check((await levels(G, owner, alice)).join() === "view,full", "a member can hold full access through a parent");
  await rejects(
    () => setPagePermission(owner, C, alice, "edit"),
    isCode("lastFullAccess"),
    "a change that leaves a subpage without full access is refused",
  );
  await rejects(
    () => removePagePermission(owner, C, alice),
    isCode("lastFullAccess"),
    "removing that entry is refused too",
  );

  // Removing entries brings back what is inherited
  await removePagePermission(alice, G, owner);
  await removePagePermission(owner, G, null);
  check((await levels(G, bob))[0] === "view", "removing an entry restores the inherited level");

  // Leaving the workspace ends user grants
  await db.delete(workspaceMember).where(inArray(workspaceMember.userId, [alice]));
  check((await levels(Pg, alice))[0] === "none", "grants stop applying once the member leaves");

  console.log(`\n${passed} checks passed`);
} finally {
  await db.delete(workspace).where(inArray(workspace.id, [workspaceId]));
  await db.delete(user).where(inArray(user.id, userIds));
  await (globalThis as unknown as { __esionageSql?: { end(): Promise<void> } }).__esionageSql?.end();
}

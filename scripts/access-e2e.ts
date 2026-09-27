/**
 * End-to-end check of page permissions against the database: defaults, inheritance, widening and
 * narrowing on subpages, visibility in lists, shared pages showing up as top-level pages, and the
 * guard that keeps someone with full access on every page, what guests can and can't see, rows
 * restricted inside a database, moving pages, what a publication exposes, and sharing by email. Creates its own users and workspace
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
const { page, pageInvitation, pagePublication, user, workspace, workspaceInvitation, workspaceMember } = await import(
  "@/db/schema"
);
const { registerCollab } = await import("@/server/collab/bridge");
const { listRows } = await import("@/server/databases");
const { getPublishedPage } = await import("@/server/publication");
const { AccessError, getMembership, requirePageAccess, resolvePageAccess } = await import("@/server/access");
const { createPage, getBreadcrumbs, getTree, listChildren, movePage, recentPages, searchPages } = await import(
  "@/server/pages"
);
const { acceptInvitation, listMembers } = await import("@/server/workspaces");
const {
  listPagePermissions,
  PermissionError,
  removePageInvitation,
  removePagePermission,
  setPagePermission,
  sharePageByEmail,
} = await import("@/server/permissions");

const RUN = `access-e2e-${Date.now().toString(36)}`;

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

const ids = {
  owner: `${RUN}-owner`,
  alice: `${RUN}-alice`,
  bob: `${RUN}-bob`,
  guest: `${RUN}-guest`,
  outsider: `${RUN}-outsider`,
  newcomer: `${RUN}-newcomer`,
};
const emailOf = (id: string) => `${id}@example.test`;
const userIds = Object.values(ids);
const workspaceId = `${RUN}-ws`;

try {
  // The newcomer has no account yet; it is created when they accept their invitation.
  await db.insert(user).values(userIds.filter((id) => id !== ids.newcomer).map((id) => ({ id, name: id, email: emailOf(id) })));
  await db.insert(workspace).values({ id: workspaceId, name: RUN });
  await db.insert(workspaceMember).values([
    { workspaceId, userId: ids.owner, role: "owner" },
    { workspaceId, userId: ids.alice, role: "member" },
    { workspaceId, userId: ids.bob, role: "member" },
    { workspaceId, userId: ids.guest, role: "guest" },
  ]);
  // R ─ C ─ G, T ─ P, and the database D with rows D1, D2
  const P = (id: string, parentId: string | null, position: number) => ({
    id: `${RUN}-${id}`,
    workspaceId,
    parentId: parentId && `${RUN}-${parentId}`,
    title: id,
    position,
  });
  await db.insert(page).values([P("R", null, 1), P("T", null, 2), { ...P("D", null, 3), kind: "database" as const }]);
  await db.insert(page).values([P("D1", "D", 1), P("D2", "D", 2)]);
  await db.insert(page).values([P("C", "R", 1), P("P", "T", 1)]);
  await db.insert(page).values([P("G", "C", 1)]);
  const [R, C, G, T, Pg, D, D1, D2] = ["R", "C", "G", "T", "P", "D", "D1", "D2"].map((name) => `${RUN}-${name}`);
  const { owner, alice, bob, guest, outsider, newcomer } = ids;

  // Defaults
  check(
    JSON.stringify(await levels(G, owner, alice, bob, guest, outsider)) === '["full","full","full","none","none"]',
    "without entries members get full access, guests and outsiders none",
  );
  check((await getTree(guest, workspaceId)).length === 0, "a guest's tree starts empty");
  await rejects(
    () => createPage({ userId: guest }, { workspaceId, title: "guest page" }),
    isAccessError,
    "guests can't create top-level pages",
  );
  await rejects(() => listMembers(guest, workspaceId), isAccessError, "guests can't list the workspace's members");

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
  check((await levels(R, guest))[0] === "none", "what everyone gets doesn't reach guests");
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

  // Moving a page changes who inherits access to it
  await rejects(() => movePage(alice, C, null), isAccessError, "edit access can't move a page to another parent");
  await movePage(alice, G, C, 5);
  check(true, "edit access can still reorder a page among its siblings");

  // A publication shows only what its publisher can see
  const token = `${RUN}-token`;
  await db.insert(pagePublication).values({ pageId: R, token, publishedBy: bob });
  const publishedC = await getPublishedPage(token, C);
  check(publishedC?.children.length === 0, "a publication leaves out subpages its publisher can't see", publishedC?.children);
  check((await getPublishedPage(token, G)) === null, "…and won't serve them by id");
  check((await getPublishedPage(token, C)) !== null, "…while serving the ones they can");

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
  check(JSON.stringify(aliceRoots) === JSON.stringify([Pg, R, D].sort()), "…and in the top-level list", aliceRoots);
  const crumbs = (await getBreadcrumbs(alice, Pg)).map((c) => c.id);
  check(JSON.stringify(crumbs) === JSON.stringify([Pg]), "breadcrumbs skip hidden ancestors", crumbs);
  check((await levels(Pg, bob))[0] === "none", "the shared page stays hidden from others");

  // Guests see exactly what is shared with them
  await setPagePermission(owner, Pg, guest, "edit");
  const guestTree = await getTree(guest, workspaceId);
  check(
    guestTree.length === 1 && guestTree[0].id === Pg && guestTree[0].parentId === null,
    "a guest's tree holds only the page shared with them, at the top level",
    guestTree,
  );
  const guestRoots = (await listChildren(guest, workspaceId, null)).map((p) => p.id);
  check(JSON.stringify(guestRoots) === JSON.stringify([Pg]), "…and so does their top-level list", guestRoots);
  const guestRecent = (await recentPages(guest, workspaceId, 50)).map((p) => p.id);
  check(JSON.stringify(guestRecent) === JSON.stringify([Pg]), "recent pages show guests only their pages", guestRecent);
  const hits = async (q: string) => (await searchPages(guest, q, { workspaceId })).map((h) => h.id);
  check((await hits("R")).length === 0 && JSON.stringify(await hits("P")) === JSON.stringify([Pg]), "search too");
  check((await levels(Pg, guest))[0] === "edit", "a guest gets the level they were given");

  // Rows restricted inside a database
  await setPagePermission(owner, D2, owner, "full");
  await setPagePermission(owner, D2, null, "none");
  const rowIds = async (id: string) => (await listRows(id, D)).map((r) => r.id);
  check(JSON.stringify(await rowIds(bob)) === JSON.stringify([D1]), "a restricted row is left out of its database");
  check(JSON.stringify(await rowIds(owner)) === JSON.stringify([D1, D2]), "…but not for those it is shared with");

  // Guests can't move pages to the top level
  await setPagePermission(owner, Pg, guest, "full");
  await rejects(() => movePage(guest, Pg, null), isAccessError, "a guest can't move a page to the top level");
  await setPagePermission(owner, Pg, guest, "edit");

  // Sharing by email
  check((await sharePageByEmail(owner, Pg, emailOf(bob).toUpperCase(), "view")).kind === "shared", "a member's email shares right away");
  check((await levels(Pg, bob))[0] === "view", "…with the level asked for");
  await rejects(() => sharePageByEmail(owner, Pg, "not-an-email", "view"), isCode("invalidEmail"), "a bad address is refused");
  await setPagePermission(owner, C, alice, "full");
  await rejects(
    () => sharePageByEmail(alice, C, emailOf(newcomer), "view"),
    isCode("ownersOnly"),
    "only owners bring new people in",
  );
  check((await sharePageByEmail(owner, Pg, emailOf(outsider), "edit")).kind === "added", "an existing account joins as a guest");
  check(
    (await getMembership(outsider, workspaceId))?.role === "guest" && (await levels(Pg, outsider))[0] === "edit",
    "…and gets the page",
  );
  const invited = await sharePageByEmail(owner, Pg, emailOf(newcomer), "edit");
  check(invited.kind === "invited", "someone without an account is invited", invited);
  const pending = await listPagePermissions(owner, Pg);
  check(
    pending.invitations.some((i) => i.email === emailOf(newcomer) && i.level === "edit"),
    "the page lists whom it waits for",
    pending.invitations,
  );
  check((await listPagePermissions(bob, Pg)).invitations.length === 0, "…but only to those who manage it");
  const [invitation] = await db
    .select({ token: workspaceInvitation.token, role: workspaceInvitation.role })
    .from(workspaceInvitation)
    .where(inArray(workspaceInvitation.email, [emailOf(newcomer)]));
  check(invitation?.role === "guest", "the workspace invitation is for a guest");
  await db.insert(user).values({ id: newcomer, name: newcomer, email: emailOf(newcomer) });
  await acceptInvitation(invitation.token, newcomer, emailOf(newcomer));
  check((await levels(Pg, newcomer))[0] === "edit", "accepting the invitation turns it into access to the page");
  const leftover = await db.select().from(pageInvitation).where(inArray(pageInvitation.workspaceId, [workspaceId]));
  check(leftover.length === 0, "…and nothing waits any more");

  const later = `${RUN}-later@example.test`;
  await db.insert(workspaceInvitation).values({
    workspaceId,
    email: later,
    role: "member",
    token: `${RUN}-later`,
    expiresAt: new Date(Date.now() + 60_000),
  });
  await sharePageByEmail(owner, Pg, later, "view");
  const [kept] = await db.select({ role: workspaceInvitation.role }).from(workspaceInvitation).where(inArray(workspaceInvitation.email, [later]));
  check(kept?.role === "member", "sharing a page doesn't lower a pending invitation's role");
  const stranger = `${RUN}-stranger@example.test`;
  await sharePageByEmail(owner, Pg, stranger, "view");
  await removePageInvitation(owner, Pg, stranger);
  const strangerInvites = await db.select().from(workspaceInvitation).where(inArray(workspaceInvitation.email, [stranger]));
  check(strangerInvites.length === 0, "cancelling the only page a guest was invited to withdraws the invitation");

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

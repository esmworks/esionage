/**
 * End-to-end check of gallery and list views against the database: the settings new views start
 * with, config validation, gallery covers in the database snapshot (read from row bodies, only
 * while a gallery shows them, and only for rows the viewer can see), and creating and updating
 * these views over MCP.
 * Creates its own users and workspace and deletes them afterwards.
 *
 *   pnpm tsx scripts/views-e2e.ts
 *
 * Env: DATABASE_URL (read from .env when present). Migrations must be applied.
 */
export {};

try {
  process.loadEnvFile();
} catch {}

// Imported after .env is loaded: the database client reads DATABASE_URL when it is created.
const { inArray, sql } = await import("drizzle-orm");
const { db } = await import("@/db");
const { page, user, workspace, workspaceMember } = await import("@/db/schema");
const { markdownImageHint, PG_MARKDOWN_IMAGE_PATTERN } = await import("@/lib/cover");
const { InMemoryTransport } = await import("@modelcontextprotocol/server");
const { registerCollab } = await import("@/server/collab/bridge");
const { createCollab } = await import("@/server/collab/service");
const { createMcpServer } = await import("@/server/mcp/tools");
const { READ_SCOPE, WRITE_SCOPE } = await import("@/server/mcp/principal");
const { addView, getDatabaseSnapshot, updateView } = await import("@/server/databases");
const { createPage } = await import("@/server/pages");
const { setPagePermission } = await import("@/server/permissions");
const { AccessError } = await import("@/server/access");
const { PropertyValueError } = await import("@/lib/properties");

const RUN = `views-e2e-${Date.now().toString(36)}`;

// The real collab service, so row bodies are stored the way the editor stores them.
const { hocuspocus, service } = createCollab();
registerCollab(service);

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

async function rejects(fn: () => Promise<unknown>, code: string) {
  try {
    await fn();
    return false;
  } catch (error) {
    return error instanceof PropertyValueError && error.code === code;
  }
}

/** Calls an MCP tool as `userId` with read and write access, the way a connected AI app would. */
async function callTool(userId: string, name: string, args: Record<string, unknown>) {
  const server = createMcpServer({ userId, clientId: `${RUN}-client`, scopes: [READ_SCOPE, WRITE_SCOPE] });
  const [client, serverSide] = InMemoryTransport.createLinkedPair();
  const inbox: { id?: unknown; result?: { isError?: boolean; content: { text: string }[] } }[] = [];
  client.onmessage = (m) => void inbox.push(m as (typeof inbox)[number]);
  await server.connect(serverSide);
  await client.start();
  const waitFor = async (id: number) => {
    for (let i = 0; i < 400; i++) {
      const hit = inbox.find((m) => m.id === id);
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error(`no MCP response for ${name}`);
  };
  await client.send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "views-e2e", version: "1" } },
  });
  await waitFor(1);
  await client.send({ jsonrpc: "2.0", method: "notifications/initialized" });
  await client.send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: args } });
  const result = (await waitFor(2)).result!;
  await server.close();
  const text = result.content[0].text;
  return { isError: Boolean(result.isError), text, data: result.isError ? null : JSON.parse(text) };
}

const ids = { owner: `${RUN}-owner`, member: `${RUN}-member`, guest: `${RUN}-guest` };
const userIds = Object.values(ids);
const workspaceId = `${RUN}-ws`;

try {
  await db.insert(user).values(userIds.map((id) => ({ id, name: id, email: `${id}@example.test` })));
  await db.insert(workspace).values({ id: workspaceId, name: RUN });
  await db.insert(workspaceMember).values([
    { workspaceId, userId: ids.owner, role: "owner" },
    { workspaceId, userId: ids.member, role: "member" },
    { workspaceId, userId: ids.guest, role: "guest" },
  ]);
  const actor = { userId: ids.owner };
  const tasks = await createPage(actor, { workspaceId, kind: "database", title: "Tasks" });

  // New views: names and starting settings
  const gallery = await addView(ids.owner, tasks.id, { name: " ", type: "gallery" });
  check(gallery.name === "Gallery" && gallery.type === "gallery", "a gallery without a name is called Gallery", gallery);
  check(Object.keys(gallery.config).length === 0, "a gallery starts with medium cards and first-image covers (the defaults)", gallery.config);
  const list = await addView(ids.owner, tasks.id, { name: "", type: "list" });
  check(list.name === "List" && Object.keys(list.config).length === 0, "a list view starts with default settings", list);
  check(
    await rejects(() => addView(ids.owner, tasks.id, { name: "X", type: "chart" as never }), "unsupportedViewType"),
    "an unknown view type is refused",
  );

  // Config validation
  const bad: [string, object][] = [
    ["card size", { cardSize: "huge" }],
    ["cover", { cover: { source: "files" } }],
    ["cover shape", { cover: "first_image" }],
    ["date property", { dateBy: 42 }],
  ];
  for (const [label, config] of bad) {
    check(
      await rejects(() => updateView(ids.owner, gallery.id, { config: config as never }), "invalidViewConfig"),
      `a malformed ${label} setting is refused`,
    );
  }
  await updateView(ids.owner, gallery.id, { config: { cardSize: "large", cover: { source: "first_image" } } });
  const views = (await getDatabaseSnapshot(ids.owner, tasks.id)).views;
  check(views.find((v) => v.id === gallery.id)!.config.cardSize === "large", "valid gallery settings are saved");

  const r1 = await createPage(actor, { workspaceId, parentId: tasks.id, title: "With image" });
  const r2 = await createPage(actor, { workspaceId, parentId: tasks.id, title: "Code only" });
  const r3 = await createPage(actor, { workspaceId, parentId: tasks.id, title: "Restricted" });
  const r4 = await createPage(actor, { workspaceId, parentId: tasks.id, title: "Plain" });

  // Gallery covers: the first image of the body, from the stored document
  await service.replaceContent(r1.id, "Intro\n\n![first](https://example.test/first.png)\n\n![second](https://example.test/second.png)", actor);
  await service.replaceContent(r2.id, "```\n![code](https://example.test/code.png)\n```", actor);
  await service.replaceContent(r3.id, "![secret](https://example.test/secret.png)", actor);
  await service.replaceContent(r4.id, "No pictures here", actor);
  const covers = async (userId: string) =>
    Object.fromEntries((await getDatabaseSnapshot(userId, tasks.id)).rows.map((r) => [r.title, r.cover]));
  const withGallery = await covers(ids.owner);
  check(withGallery["With image"] === "https://example.test/first.png", "a row's cover is the first image in its body", withGallery);
  check(withGallery["Code only"] === null, "image Markdown inside a code block is not a cover", withGallery);
  check(withGallery.Plain === null, "a row without images has no cover", withGallery);

  // Saving a body compares the old and new first image Markdown (Postgres and JS regexes) to tell
  // open galleries about a new cover; both must find the same match.
  const hints = await db
    .select({ markdown: page.contentMarkdown, hint: sql<string | null>`substring(${page.contentMarkdown} from ${PG_MARKDOWN_IMAGE_PATTERN})` })
    .from(page)
    .where(inArray(page.id, [r1.id, r2.id, r4.id]));
  check(
    hints.every((h) => h.hint === markdownImageHint(h.markdown)) && hints.filter((h) => h.hint).length === 2,
    "Postgres and JS find the same image Markdown in a body",
    hints,
  );

  await service.replaceContent(r1.id, "![new](/files/new.png)", actor);
  check((await covers(ids.owner))["With image"] === "/files/new.png", "a changed body changes the cover");

  // Access: covers only come with rows the viewer can see
  await setPagePermission(ids.owner, r3.id, ids.owner, "full");
  await setPagePermission(ids.owner, r3.id, null, "none");
  const memberCovers = await covers(ids.member);
  check(!("Restricted" in memberCovers), "a restricted row and its cover stay hidden from members", memberCovers);
  check(memberCovers["With image"] === "/files/new.png", "members see covers of the rows they can see");
  let guestBlocked = false;
  try {
    await getDatabaseSnapshot(ids.guest, tasks.id);
  } catch (error) {
    guestBlocked = error instanceof AccessError;
  }
  check(guestBlocked, "a guest without access gets no snapshot, covers included");
  await setPagePermission(ids.owner, tasks.id, ids.guest, "view");
  // The guest's own entry on the database would reach the restricted row; one on the row itself wins.
  await setPagePermission(ids.owner, r3.id, ids.guest, "none");
  const guestCovers = await covers(ids.guest);
  check(
    guestCovers["With image"] === "/files/new.png" && !("Restricted" in guestCovers),
    "a guest the database is shared with sees covers of the rows shared with them",
    guestCovers,
  );

  // Covers are only read while a gallery shows them
  await updateView(ids.owner, gallery.id, { config: { cover: { source: "none" } } });
  const noCovers = (await getDatabaseSnapshot(ids.owner, tasks.id)).rows;
  check(noCovers.every((r) => !("cover" in r)), "without a gallery showing covers, rows carry no cover field", noCovers[0]);
  await updateView(ids.owner, gallery.id, { config: {} });

  // MCP: create and update the new views
  const cards = await callTool(ids.owner, "create_database_view", {
    database_id: tasks.id,
    name: "Cards",
    type: "gallery",
    card_size: "small",
    cover: "none",
  });
  check(!cards.isError && cards.data.card_size === "small" && cards.data.cover === "none", "MCP creates a gallery with its settings", cards.text);
  const listed = await callTool(ids.owner, "create_database_view", { database_id: tasks.id, name: "Compact", type: "list" });
  check(!listed.isError && listed.data.type === "list", "MCP creates a list view", listed.text);
  const wrong = await callTool(ids.owner, "update_database_view", { database_id: tasks.id, view_id: listed.data.id, cover: "none" });
  check(wrong.isError && /only applies to gallery/.test(wrong.text), "MCP refuses gallery settings on a list", wrong.text);
  const resized = await callTool(ids.owner, "update_database_view", { database_id: tasks.id, view_id: cards.data.id, card_size: "large" });
  check(!resized.isError && resized.data.card_size === "large" && resized.data.cover === "none", "MCP changes one gallery setting", resized.text);
  const described = await callTool(ids.owner, "get_database", { database_id: tasks.id });
  const describedCards = described.data.views.find((v: { id: string }) => v.id === cards.data.id);
  check(describedCards?.type === "gallery" && describedCards.card_size === "large", "get_database describes gallery settings", describedCards);

  console.log(`\n${passed} checks passed`);
} finally {
  await db.delete(workspace).where(inArray(workspace.id, [workspaceId]));
  await db.delete(user).where(inArray(user.id, userIds));
  hocuspocus.closeConnections();
  await (globalThis as unknown as { __esionageSql?: { end(): Promise<void> } }).__esionageSql?.end();
}

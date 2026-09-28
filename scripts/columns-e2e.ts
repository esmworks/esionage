/**
 * End-to-end check of columns: Markdown in and out through MCP (get_page → update_page keeps the
 * columns), mentions and comments inside columns, two collaborators seeing the same columns (moving
 * a block between columns, resizing, undoing), and published pages. Creates its own users and
 * workspace and deletes them afterwards.
 *
 *   pnpm tsx scripts/columns-e2e.ts
 *
 * Env: DATABASE_URL (read from .env when present). Migrations must be applied. With APP_URL
 * pointing at a running server (on the same database), the published page is also fetched from it.
 */
export {};

try {
  process.loadEnvFile();
} catch {}

// Imported after .env is loaded: the database client reads DATABASE_URL when it is created.
const { and, eq, inArray } = await import("drizzle-orm");
const Y = await import("yjs");
const { db } = await import("@/db");
const { notification, page, user, workspace, workspaceMember } = await import("@/db/schema");
const { COLLAB_FRAGMENT } = await import("@/lib/collab-constants");
const { getCollab, registerCollab } = await import("@/server/collab/bridge");
const { createCollab } = await import("@/server/collab/service");
const { threadQuotes } = await import("@/server/collab/comment-marks");
const { serverEditor } = await import("@/server/blocknote");
const { changeComments } = await import("@/server/comments");
const { createPage } = await import("@/server/pages");
const { getPublishedPage, publishPage } = await import("@/server/publication");
const { InMemoryTransport } = await import("@modelcontextprotocol/server");
const { createServer } = await import("node:http");
const crossws = (await import("crossws/adapters/node")).default;
const { HocuspocusProvider } = await import("@hocuspocus/provider");
const { issueCollabToken } = await import("@/server/collab/token");
const { createMcpServer } = await import("@/server/mcp/tools");
const { READ_SCOPE, WRITE_SCOPE } = await import("@/server/mcp/principal");

const RUN = `columns-e2e-${Date.now().toString(36)}`;

const { hocuspocus, service } = createCollab();
registerCollab(service);

let passed = 0;
function check(condition: unknown, label: string, detail?: unknown): asserts condition {
  if (!condition) {
    console.error(`FAIL  ${label}`);
    if (detail !== undefined) console.error(typeof detail === "string" ? detail : JSON.stringify(detail, null, 2));
    throw new Error(`Check failed: ${label}`);
  }
  passed++;
  console.log(`ok    ${label}`);
}

/** Calls an MCP tool as `userId`, the way a connected AI app would. */
async function callTool(userId: string, name: string, args: Record<string, unknown>, scopes = [READ_SCOPE, WRITE_SCOPE]) {
  const server = createMcpServer({ userId, clientId: `${RUN}-client`, scopes });
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
    params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "columns-e2e", version: "1" } },
  });
  await waitFor(1);
  await client.send({ jsonrpc: "2.0", method: "notifications/initialized" });
  await client.send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: args } });
  const result = (await waitFor(2)).result!;
  await server.close();
  const text = result.content[0].text;
  return { isError: Boolean(result.isError), text, data: result.isError ? null : JSON.parse(text) };
}

type AnyBlock = { id?: string; type: string; props?: Record<string, unknown>; content?: unknown; children?: AnyBlock[] };

const textOf = (b: AnyBlock) => (Array.isArray(b.content) ? b.content.map((c: { text?: string }) => c.text ?? "").join("") : "");
/** Blocks as a compact tree: "columnList(column[1](paragraph:A),column[2](…))". */
const shape = (blocks: AnyBlock[]): string =>
  blocks
    .map(
      (b) =>
        b.type +
        (b.type === "column" ? `[${b.props?.width}]` : "") +
        (b.children?.length ? `(${shape(b.children)})` : "") +
        (textOf(b) && b.type !== "mermaid" ? `:${textOf(b)}` : ""),
    )
    .join(",");

/** The page's document as stored or, while open, live. */
async function withDoc<T>(pageId: string, fn: (doc: InstanceType<typeof Y.Doc>) => T): Promise<T> {
  const live = hocuspocus.documents.get(`page:${pageId}`);
  if (live) return fn(live);
  const [row] = await db.select({ ydoc: page.ydoc }).from(page).where(eq(page.id, pageId));
  const doc = new Y.Doc();
  if (row?.ydoc) Y.applyUpdate(doc, row.ydoc);
  try {
    return fn(doc);
  } finally {
    doc.destroy();
  }
}

async function until(label: string, test: () => boolean | Promise<boolean>, ms = 5000) {
  for (let waited = 0; waited < ms; waited += 50) {
    if (await test()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`timed out: ${label}`);
}

const ids = { owner: `${RUN}-owner`, editor: `${RUN}-editor` };
const userIds = Object.values(ids);
const workspaceId = `${RUN}-ws`;

const BODY = [
  "# Plan",
  "",
  "<!-- leafdesk:columns -->",
  "",
  "<!-- leafdesk:column -->",
  "",
  "## Left",
  "",
  `Ask @${ids.editor} about the budget.`,
  "",
  "<!-- leafdesk:column width=1.5 -->",
  "",
  "```mermaid",
  "graph TD",
  "  A-->B",
  "```",
  "",
  "Right side text.",
  "",
  "<!-- leafdesk:/columns -->",
  "",
  "After the columns.",
].join("\n");

try {
  await db.insert(user).values(userIds.map((id) => ({ id, name: id, email: `${id}@example.test` })));
  await db.insert(workspace).values({ id: workspaceId, name: RUN });
  await db.insert(workspaceMember).values([
    { workspaceId, userId: ids.owner, role: "owner" },
    { workspaceId, userId: ids.editor, role: "member" },
  ]);
  const owner = { userId: ids.owner };
  const doc = await createPage(owner, { workspaceId, title: "Columns" });

  // Markdown through MCP
  let r = await callTool(ids.owner, "update_page", { page_id: doc.id, markdown: BODY });
  check(!r.isError, "update_page takes Markdown with columns", r.text);
  let { blocks } = await getCollab().readBlocks(doc.id);
  const expected = `heading:Plan,columnList(column[1](heading:Left,paragraph:Ask  about the budget.),column[1.5](mermaid,paragraph:Right side text.)),paragraph:After the columns.`;
  check(shape(blocks as AnyBlock[]) === expected, "…and stores real columns with their widths", shape(blocks as AnyBlock[]));
  r = await callTool(ids.owner, "get_page", { page_id: doc.id }, [READ_SCOPE]);
  const read = r.data?.markdown as string;
  check(
    !r.isError &&
      read.includes("<!-- leafdesk:columns -->\n\n<!-- leafdesk:column -->\n\n## Left") &&
      read.includes("<!-- leafdesk:column width=1.5 -->") &&
      read.includes("<!-- leafdesk:/columns -->\n\nAfter the columns."),
    "get_page writes the columns as marker lines around their blocks",
    read,
  );
  r = await callTool(ids.owner, "update_page", { page_id: doc.id, markdown: read });
  check(!r.isError, "update_page takes the Markdown get_page gave", r.text);
  ({ blocks } = await getCollab().readBlocks(doc.id));
  check(shape(blocks as AnyBlock[]) === expected, "…and writing it back keeps the columns", shape(blocks as AnyBlock[]));
  check((await callTool(ids.owner, "get_page", { page_id: doc.id }, [READ_SCOPE])).data.markdown === read, "…and reads back the same Markdown");

  // Mentions and comments inside columns
  const mentioned = await db
    .select()
    .from(notification)
    .where(and(eq(notification.userId, ids.editor), eq(notification.kind, "mention"), eq(notification.pageId, doc.id)));
  check(mentioned.length === 1, "a person mentioned inside a column is notified once", mentioned);
  const leftText = (blocks as AnyBlock[])[1].children![0].children![1];
  const created = await changeComments(ids.owner, doc.id, {
    type: "createThread",
    body: "Which budget?",
    anchor: { quote: "the budget", blockId: leftText.id, offset: 4 },
  });
  const quotes = await withDoc(doc.id, (d) => threadQuotes(d.getXmlFragment(COLLAB_FRAGMENT)));
  check(created.anchored && quotes.get(created.thread!.id) === "the budget", "a comment on text inside a column marks that text", Object.fromEntries(quotes));
  r = await callTool(ids.owner, "add_comment", { page_id: doc.id, text: "Nice diagram side.", quote: "Right side" });
  check(!r.isError, "add_comment finds quotes inside columns", r.text);

  // Two collaborators
  const ws = crossws({
    hooks: {
      open(peer) {
        (peer as unknown as { hp: ReturnType<typeof hocuspocus.handleConnection> }).hp = hocuspocus.handleConnection(
          peer.websocket as never,
          peer.request as Request,
        );
      },
      message(peer, message) {
        (peer as unknown as { hp?: { handleMessage(m: Uint8Array): void } }).hp?.handleMessage(message.uint8Array());
      },
      close(peer, event) {
        (peer as unknown as { hp?: { handleClose(e: unknown): void } }).hp?.handleClose({ code: event.code, reason: event.reason });
      },
    },
  });
  const server = createServer();
  server.on("upgrade", (req, socket, head) => ws.handleUpgrade(req, socket, head));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const connect = async (userId: string) => {
    const ydoc = new Y.Doc();
    const provider = new HocuspocusProvider({
      url: `ws://127.0.0.1:${port}`,
      name: `page:${doc.id}`,
      document: ydoc,
      token: issueCollabToken(userId, userId),
    });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("never synced")), 5000);
      provider.on("synced", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    return { ydoc, provider, blocks: () => serverEditor.yXmlFragmentToBlocks(ydoc.getXmlFragment(COLLAB_FRAGMENT)) as AnyBlock[] };
  };
  const a = await connect(ids.owner);
  const b = await connect(ids.editor);
  try {
    check(shape(a.blocks()) === shape(b.blocks()) && shape(a.blocks()) === expected, "both collaborators open the same columns", [shape(a.blocks()), shape(b.blocks())]);
    // A moves "Right side text." into the left column and makes the columns equal.
    const undo = new Y.UndoManager(a.ydoc.getXmlFragment(COLLAB_FRAGMENT), { trackedOrigins: new Set(["local"]) });
    const current = a.blocks();
    const list = current[1];
    const [left, right] = list.children!;
    const moved = right.children!.pop()!;
    left.children!.push(moved);
    right.props = { width: 1 };
    a.ydoc.transact(() => serverEditor.blocksToYXmlFragment(current as never, a.ydoc.getXmlFragment(COLLAB_FRAGMENT)), "local");
    const after = `heading:Plan,columnList(column[1](heading:Left,paragraph:Ask  about the budget.,paragraph:Right side text.),column[1](mermaid)),paragraph:After the columns.`;
    await until("B sees the move", () => shape(b.blocks()) === after);
    check(true, "a block moved into another column and a resize show for the other collaborator");
    await until("the server has it", async () => shape((await getCollab().readBlocks(doc.id)).blocks as AnyBlock[]) === after);
    check(true, "…and on the server");
    const movedId = a.blocks()[1].children![0].children![2].id;
    check(movedId === moved.id, "the moved block keeps its id", [movedId, moved.id]);
    undo.undo();
    await until("B sees the undo", () => shape(b.blocks()) === expected);
    check(shape(a.blocks()) === expected, "undo puts the block back in its column, with the width, for both");
    undo.destroy();
  } finally {
    a.provider.destroy();
    b.provider.destroy();
    await new Promise((resolve) => server.close(resolve));
  }

  // Published page
  const published = await publishPage(ids.owner, doc.id);
  const view = await getPublishedPage(published.token);
  const body = view?.body ?? [];
  const kinds = body.map((s) => s.kind).join(",");
  check(kinds === "html,columns,html", "the published page has the columns between the text", kinds);
  const cols = body[1]?.kind === "columns" ? body[1].columns : [];
  check(
    cols.length === 2 && cols[0].width === 1 && cols[1].width === 1.5 && cols[1].segments.map((s) => s.kind).join() === "mermaid,html",
    "…each column with its width and its own parts (the diagram drawn in place)",
    cols,
  );
  const leftHtml = cols[0]?.segments.map((s) => (s.kind === "html" ? s.html : "")).join("") ?? "";
  check(leftHtml.includes('<h2 id="heading-2"') && leftHtml.includes(`@${ids.editor}`), "…with heading anchors and mentions as text", leftHtml);
  const appUrl = process.env.APP_URL;
  if (appUrl) {
    const res = await fetch(`${appUrl}/s/${published.token}`).catch(() => null);
    if (res?.ok) {
      const html = await res.text();
      check(
        /class="[^"]*columns[^"]*"/.test(html) && html.includes("flex-grow:1.5") && html.includes("Right side text."),
        "the published page renders the columns side by side",
        html.slice(0, 500),
      );
    } else {
      console.log(`skip  published page over HTTP (${appUrl} not reachable)`);
    }
  }

  console.log(`\n${passed} checks passed`);
} finally {
  hocuspocus.closeConnections();
  await db.delete(workspace).where(inArray(workspace.id, [workspaceId]));
  await db.delete(user).where(inArray(user.id, userIds));
  await (globalThis as unknown as { __leafdeskSql?: { end(): Promise<void> } }).__leafdeskSql?.end();
}

process.exit(0);

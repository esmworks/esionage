/**
 * End-to-end check of offline editing (#10) over real websockets and the real collab server:
 * - a page's copy kept in the browser (what y-indexeddb stores) takes edits without a connection,
 *   and they reach the server and the database once it connects again, merged with changes other
 *   people made meanwhile, comment threads intact;
 * - loading that copy before connecting matters: sent as one update it would touch the comment
 *   threads, which the server refuses from browsers; the sync handshake sends only the new edits;
 * - an open page whose server went away (stopped, network gone) sends its edits when it returns;
 * - refusals say why, so browsers drop their copy only when access is really gone.
 * Creates its own users and workspace and deletes them afterwards.
 *
 *   pnpm tsx scripts/offline-e2e.ts
 *
 * Env: DATABASE_URL (read from .env when present). Migrations must be applied.
 */
export {};

try {
  process.loadEnvFile();
} catch {}

const { eq, and, inArray } = await import("drizzle-orm");
const Y = await import("yjs");
const { db } = await import("@/db");
const { page, user, workspace, workspaceMember } = await import("@/db/schema");
const { COLLAB_FRAGMENT } = await import("@/lib/collab-constants");
const { COLLAB_FORBIDDEN, COLLAB_UNAUTHORIZED } = await import("@/lib/offline");
const { registerCollab } = await import("@/server/collab/bridge");
const { createCollab } = await import("@/server/collab/service");
const { touchesThreads } = await import("@/server/collab/thread-guard");
const { issueCollabToken } = await import("@/server/collab/token");
const { serverEditor } = await import("@/server/blocknote");
const { changeComments } = await import("@/server/comments");
const { createPage } = await import("@/server/pages");
const { createServer } = await import("node:http");
const crossws = (await import("crossws/adapters/node")).default;
const { HocuspocusProvider, HocuspocusProviderWebsocket } = await import("@hocuspocus/provider");

const RUN = `offline-e2e-${Date.now().toString(36)}`;

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

async function eventually(fn: () => boolean | Promise<boolean>, ms = 5000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return fn();
}

const ids = { owner: `${RUN}-owner`, other: `${RUN}-other` };
const userIds = Object.values(ids);
const workspaceId = `${RUN}-ws`;

type Peer = { hp?: { handleMessage(m: Uint8Array): void; handleClose(e: unknown): void } };
const ws = crossws({
  hooks: {
    open(peer) {
      (peer as unknown as Peer).hp = hocuspocus.handleConnection(peer.websocket as never, peer.request as Request) as never;
    },
    message(peer, message) {
      (peer as unknown as Peer).hp?.handleMessage(message.uint8Array());
    },
    close(peer, event) {
      (peer as unknown as Peer).hp?.handleClose({ code: event.code, reason: event.reason });
    },
  },
});

/** The app's server, stopped and started again on the same port (the "offline" part). */
let server = createServer();
async function startServer(port = 0) {
  server = createServer();
  server.on("upgrade", (req, socket, head) => ws.handleUpgrade(req, socket, head));
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  return (server.address() as { port: number }).port;
}
async function stopServer() {
  hocuspocus.closeConnections();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}

const port = await startServer();
const providers: InstanceType<typeof HocuspocusProvider>[] = [];
const sockets: InstanceType<typeof HocuspocusProviderWebsocket>[] = [];

/** A tab with the page open. `doc`: the page's copy from this browser, loaded before connecting. */
function open(pageId: string, who: keyof typeof ids, doc = new Y.Doc(), token = issueCollabToken(ids[who], who)) {
  const socket = new HocuspocusProviderWebsocket({ url: `ws://127.0.0.1:${port}`, delay: 50, minDelay: 50, maxDelay: 200 });
  const provider = new HocuspocusProvider({ websocketProvider: socket, name: `page:${pageId}`, document: doc, token });
  provider.attach();
  providers.push(provider);
  sockets.push(socket);
  return provider;
}

async function synced(provider: InstanceType<typeof HocuspocusProvider>, label: string) {
  check(await eventually(() => provider.isSynced && !provider.hasUnsyncedChanges), label);
}

/** What typing a new last paragraph in the editor does to the document. */
function typeParagraph(doc: InstanceType<typeof Y.Doc>, text: string) {
  const fragment = doc.getXmlFragment(COLLAB_FRAGMENT);
  const blocks = serverEditor.yXmlFragmentToBlocks(fragment);
  doc.transact(() => {
    serverEditor.blocksToYXmlFragment([...blocks, { type: "paragraph", content: text } as never], fragment);
  });
}

const textOf = (doc: InstanceType<typeof Y.Doc>) =>
  JSON.stringify(serverEditor.yXmlFragmentToBlocks(doc.getXmlFragment(COLLAB_FRAGMENT)));

async function stored(pageId: string) {
  const [row] = await db.select({ markdown: page.contentMarkdown }).from(page).where(eq(page.id, pageId));
  return row?.markdown ?? "";
}

try {
  await db.insert(user).values(userIds.map((id) => ({ id, name: id, email: `${id}@example.test` })));
  await db.insert(workspace).values({ id: workspaceId, name: RUN });
  await db.insert(workspaceMember).values([
    { workspaceId, userId: ids.owner, role: "owner" },
    { workspaceId, userId: ids.other, role: "member" },
  ]);
  const created = await createPage({ userId: ids.owner }, { workspaceId, title: "Field notes" });
  const pageId = created.id;
  await service.replaceContent(pageId, "Ship the offline mode this week.", { userId: ids.owner });
  const thread = await changeComments(ids.owner, pageId, { type: "createThread", body: "Which week?", anchor: { quote: "offline mode" } });
  check(thread.anchored === true, "the page has a comment thread");

  // 1. A browser opens the page and keeps its copy (what y-indexeddb stores), then the tab closes.
  const first = open(pageId, "owner");
  await synced(first, "the first visit syncs");
  const copy = Y.encodeStateAsUpdate(first.document);
  first.destroy();

  // 2. Offline: the copy opens and takes an edit. Someone else changes the page meanwhile.
  const offlineDoc = new Y.Doc();
  Y.applyUpdate(offlineDoc, copy);
  check(textOf(offlineDoc).includes("Ship the offline mode"), "the kept copy opens without the server");
  typeParagraph(offlineDoc, "Written offline.");
  await service.appendContent(pageId, "Written on the server meanwhile.", { userId: ids.other });

  // 3. Why the copy loads before connecting: as one update it would touch the threads.
  const other = open(pageId, "other");
  await synced(other, "another person has the page open");
  check(touchesThreads(other.document, Y.encodeStateAsUpdate(offlineDoc)), "the whole copy as one update would be refused (it holds the threads)");
  check(
    !touchesThreads(other.document, Y.encodeStateAsUpdate(offlineDoc, Y.encodeStateVector(other.document))),
    "what the sync handshake sends (only the edits made offline) is accepted",
  );

  // 4. Back online: the provider connects with the copy already loaded, as components/collab/socket does.
  const back = open(pageId, "owner", offlineDoc);
  await synced(back, "the offline copy syncs when the connection is back");
  check(textOf(back.document).includes("Written on the server meanwhile."), "…and gets what others wrote meanwhile");
  check(await eventually(() => textOf(other.document).includes("Written offline.")), "the offline edit reaches the others");
  check(
    await eventually(async () => {
      const markdown = await stored(pageId);
      return markdown.includes("Written offline.") && markdown.includes("Written on the server meanwhile.");
    }, 15000),
    "both edits are saved in the database",
    await stored(pageId),
  );
  check((await service.readThreads(pageId)).length === 1, "the comment thread is untouched");

  // 5. The page stays open while the server goes away (stopped, network gone), and comes back.
  await stopServer();
  check(await eventually(() => back.configuration.websocketProvider.status === "disconnected"), "the open page notices the server is gone");
  typeParagraph(back.document, "Typed while the server was down.");
  check(back.hasUnsyncedChanges, "the edit waits for the server");
  await startServer(port);
  await synced(back, "the open page reconnects and sends it");
  check(
    await eventually(async () => (await stored(pageId)).includes("Typed while the server was down."), 15000),
    "the edit made while the server was down is saved",
    await stored(pageId),
  );

  // 6. Refusals say why: only "forbidden" makes browsers drop their copy.
  const reasonOf = async (provider: InstanceType<typeof HocuspocusProvider>) => {
    let reason: string | null = null;
    provider.on("authenticationFailed", ({ reason: r }: { reason: string }) => (reason = r));
    await eventually(() => reason !== null);
    return reason;
  };
  check((await reasonOf(open(pageId, "owner", new Y.Doc(), "not-a-token"))) === COLLAB_UNAUTHORIZED, "a bad or expired token is 'unauthorized' (the copy stays)");
  await db.delete(workspaceMember).where(and(eq(workspaceMember.workspaceId, workspaceId), eq(workspaceMember.userId, ids.other)));
  check((await reasonOf(open(pageId, "other"))) === COLLAB_FORBIDDEN, "someone who lost access is told 'forbidden' (the copy goes)");

  console.log(`\n${passed} checks passed`);
} finally {
  for (const provider of providers) provider.destroy();
  for (const socket of sockets) socket.destroy();
  hocuspocus.flushPendingStores();
  await new Promise((r) => setTimeout(r, 500));
  await stopServer().catch(() => {});
  await db.delete(workspace).where(inArray(workspace.id, [workspaceId]));
  await db.delete(user).where(inArray(user.id, userIds));
  await (globalThis as unknown as { __esionageSql?: { end(): Promise<void> } }).__esionageSql?.end();
}

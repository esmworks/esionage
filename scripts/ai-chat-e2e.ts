/**
 * End-to-end check of the AI chat (#41) against the database, with a fake OpenAI-compatible server
 * (src/server/ai/fake-openai.ts) for the model and for embeddings, reached over HTTP like a real
 * provider, and scripted per test: the question's search, the model's search_pages and read_page
 * calls, the streamed answer and its citations; conversations (kept, continued with their history,
 * listed, shown, deleted, only ever to their owner, gone when the person leaves the workspace);
 * stopping an answer; the round limit, input and rate limits and a failing provider; the page
 * scope; the workspace switch and a server without AI; and access, checked on every tool call: a
 * private page shared with nobody, a private teamspace, a page shared with a group, a guest, another
 * workspace, and a page whose access is taken back between two questions.
 * Creates its own users and workspaces and deletes them afterwards.
 *
 *   pnpm tsx scripts/ai-chat-e2e.ts
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
const { aiConversation, teamspace, user, workspace, workspaceMember } = await import("@/db/schema");
const { registerCollab } = await import("@/server/collab/bridge");
const { createCollab } = await import("@/server/collab/service");
const { createPage } = await import("@/server/pages");
const { removePagePermission, setPageGroupPermission, setPagePermission } = await import("@/server/permissions");
const { createGroup } = await import("@/server/groups");
const { createTeamspace } = await import("@/server/teamspaces");
const { removeMember, updateWorkspaceSettings } = await import("@/server/workspaces");
const { AccessError } = await import("@/server/access");
const { isAiError } = await import("@/server/ai");
const { resetAi, setAiEnv } = await import("@/server/ai/testing");
const { startFakeOpenAi, textOf } = await import("@/server/ai/fake-openai");
type FakeChatRequest = import("@/server/ai/fake-openai").FakeChatRequest;
type FakeReply = import("@/server/ai/fake-openai").FakeReply;
const index = await import("@/server/semantic-index");
const { deleteConversations, getConversation, listConversations, MAX_ROUNDS, startChat } = await import("@/server/ai-chat");
const { MAX_CHAT_MESSAGE, MAX_CHAT_TURNS } = await import("@/lib/ai-chat");
type ChatEvent = import("@/lib/ai-chat").ChatEvent;
type ChatInput = import("@/server/ai-chat").ChatInput;

const RUN = `aichat-e2e-${Date.now().toString(36)}`;

const { hocuspocus, service } = createCollab();
registerCollab(service);
const fake = await startFakeOpenAi();

const AI = {
  AI_PROVIDER: "openai-compatible",
  AI_MODEL: "fake-chat",
  AI_BASE_URL: fake.baseUrl,
  AI_EMBEDDINGS_MODEL: "fake-embed",
  AI_EMBEDDINGS_BASE_URL: fake.baseUrl,
  AI_EMBEDDINGS_API_KEY: "local-test",
  AI_EMBEDDINGS_MIN_SIMILARITY: "0.25",
  AI_WORKSPACE_RATE_LIMIT: "1000",
  AI_RATE_LIMIT: "1000",
};
setAiEnv(AI);

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function settle(timeoutMs = 30_000) {
  const until = Date.now() + timeoutMs;
  while (index.indexBusy()) {
    if (Date.now() > until) throw new Error("The index did not settle in time");
    await sleep(100);
  }
  await index.whenIndexIdle();
}

/** The AI error code `fn` throws before answering (or null). */
async function refusal(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (error) {
    return isAiError(error) ? error.code : `other: ${String(error)}`;
  }
}

type Source = { n: number; pageId: string; title: string; text: string };

/** The sources a request carries (the question's and the tool results'). */
function sourcesIn(request: FakeChatRequest): Source[] {
  const out: Source[] = [];
  for (const m of request.messages) {
    for (const s of textOf(m.content).matchAll(/<source n="(\d+)" page_id="([^"]+)" title="([^"]*)">\n([\s\S]*?)\n<\/source>/g)) {
      out.push({ n: Number(s[1]), pageId: s[2], title: s[3], text: s[4] });
    }
  }
  return out;
}

/** Everything a request sends to the model, as one string (for "never sent" checks). */
const everything = (request: FakeChatRequest) => request.messages.map((m) => textOf(m.content)).join("\n");
/** Tool results the model got in this request, newest last. */
const toolResults = (request: FakeChatRequest) => request.messages.filter((m) => m.role === "tool").map((m) => textOf(m.content));

/** Runs a question to the end; returns its events and what they add up to. */
async function ask(userId: string, input: ChatInput, options: { signal?: AbortSignal; onEvent?: (e: ChatEvent) => void } = {}) {
  const events: ChatEvent[] = [];
  let text = "";
  for await (const event of await startChat(userId, input, options.signal)) {
    events.push(event);
    if (event.type === "text") text += event.text;
    if (event.type === "reset") text = "";
    options.onEvent?.(event);
  }
  const conversation = events.find((e) => e.type === "conversation");
  const sources = events.find((e) => e.type === "sources");
  const end = events[events.length - 1];
  return {
    events,
    text,
    conversationId: conversation?.type === "conversation" ? conversation.id : null,
    sources: sources?.type === "sources" ? sources.sources : [],
    error: end?.type === "error" ? end.code : null,
    done: end?.type === "done",
    tools: events.filter((e) => e.type === "tool").map((e) => (e.type === "tool" ? `${e.name}:${e.detail}` : "")),
  };
}

/**
 * A model that searches, then reads `readId` (when given), then answers citing what it read (or the
 * first source), mentioning what each tool result said.
 */
function researcher({ search, readId }: { search?: string; readId?: string }) {
  return (request: FakeChatRequest): FakeReply => {
    const results = toolResults(request);
    const calls = request.messages.filter((m) => m.role === "assistant" && m.tool_calls?.length).length;
    if (search && calls === 0) return { text: "Let me look. ", toolCalls: [{ name: "search_pages", arguments: { query: search } }] };
    if (readId && calls === (search ? 1 : 0)) return { toolCalls: [{ name: "read_page", arguments: { page_id: readId } }] };
    const sources = sourcesIn(request);
    const read = readId ? sources.filter((s) => s.pageId === readId).at(-1) : undefined;
    const cite = read ?? sources[0];
    const refused = results.some((r) => r.startsWith("No page with that id"));
    return { text: cite ? `${refused ? "I could not read that page. " : ""}The answer is in ${cite.title} [${cite.n}].` : "The workspace has nothing on it." };
  };
}

const ids = {
  owner: `${RUN}-owner`,
  alice: `${RUN}-alice`,
  bob: `${RUN}-bob`,
  carol: `${RUN}-carol`,
  dave: `${RUN}-dave`,
  guest: `${RUN}-guest`,
  outsider: `${RUN}-outsider`,
};
const userIds = Object.values(ids);
const { owner, alice, bob, carol, dave, guest, outsider } = ids;
const workspaceId = `${RUN}-ws`;
const otherWs = `${RUN}-ws2`;

try {
  await db.insert(user).values(userIds.map((id) => ({ id, name: id, email: `${id}@example.test` })));
  await db.insert(workspace).values([
    { id: workspaceId, name: RUN },
    { id: otherWs, name: `${RUN} other` },
  ]);
  await db.insert(workspaceMember).values([
    { workspaceId, userId: owner, role: "owner" },
    { workspaceId, userId: alice, role: "member" },
    { workspaceId, userId: bob, role: "member" },
    { workspaceId, userId: carol, role: "member" },
    { workspaceId, userId: dave, role: "member" },
    { workspaceId, userId: guest, role: "guest" },
    { workspaceId: otherWs, userId: outsider, role: "owner" },
  ]);
  const [general] = await db.select({ id: teamspace.id }).from(teamspace).where(eq(teamspace.workspaceId, workspaceId));
  const actor = { userId: owner };
  const fleet = await createPage(actor, { workspaceId, teamspaceId: general.id, title: "Fleet notes", markdown: "Our car needs new tyres before winter." });
  const vendors = await createPage(actor, { workspaceId, parentId: fleet.id, title: "Tyre vendors", markdown: "Vehicle tyre suppliers: Northwind Tyres." });
  const office = await createPage(actor, { workspaceId, teamspaceId: general.id, title: "Office rules", markdown: "Puppies are welcome on Fridays." });
  const diary = await createPage(actor, { workspaceId, teamspaceId: null, title: "Owner diary", markdown: "SECRET-DIARY: I will buy a new automobile." });
  const secretSpace = await createTeamspace(owner, workspaceId, { name: `${RUN} secret`, access: "private" });
  const roadmap = await createPage(actor, { workspaceId, teamspaceId: secretSpace.id, title: "Hidden roadmap", markdown: "SECRET-ROADMAP: vehicle plans for next year." });
  const travel = await createPage(actor, { workspaceId, teamspaceId: null, title: "Travel desk", markdown: "SECRET-TRAVEL: vacation requests go to Jo." });
  const travellers = await createGroup(owner, workspaceId, "Travellers", [bob]);
  await setPageGroupPermission(owner, travel.id, travellers.id, "view");
  const guestBook = await createPage(actor, { workspaceId, teamspaceId: general.id, title: "Guest handbook", markdown: "Holiday calendar for guests." });
  await setPagePermission(owner, guestBook.id, guest, "view");
  const lent = await createPage(actor, { workspaceId, teamspaceId: null, title: "Lent budget", markdown: "SECRET-LENT: the vehicle budget is 40k." });
  await setPagePermission(owner, lent.id, alice, "view");
  const theirs = await createPage({ userId: outsider }, { workspaceId: otherWs, title: "Their car", markdown: "SECRET-OTHER: automobile repairs." });
  await settle();
  const secrets = ["SECRET-DIARY", "SECRET-ROADMAP", "SECRET-OTHER"];

  // ── A question answered from the pages ──────────────────────────────────────────────────────
  fake.setChat(researcher({ search: "tyre suppliers", readId: vendors.id }));
  fake.chats.length = 0;
  const first = await ask(alice, { workspaceId, message: "Which automobile needs tyres, and who sells them?" });
  check(first.done && first.events[0].type === "conversation", "a question is answered, the conversation's id coming first", first.events);
  check(
    first.tools.join("|") === "search_pages:Which automobile needs tyres, and who sells them?|search_pages:tyre suppliers|read_page:Tyre vendors",
    "the question is searched for, then the model searches and reads a page, each shown as it happens",
    first.tools,
  );
  check(first.events.some((e) => e.type === "reset"), "text the model wrote before calling a tool is taken back");
  const vendorsSource = first.sources.find((s) => s.pageId === vendors.id);
  check(first.text.startsWith("The answer is in Tyre vendors [") && vendorsSource?.title === "Tyre vendors", "the answer cites the page it read", first);
  check(vendorsSource.workspaceId === workspaceId && vendorsSource.blockId === null, "…as a link to the page", vendorsSource);
  const firstRequest = fake.chats[0];
  const questionSources = sourcesIn(firstRequest);
  check(questionSources.some((s) => s.pageId === fleet.id && s.text.includes("car needs new tyres")), "the question goes to the model with the best passages (found by meaning)", questionSources);
  check(fake.chats.every((r) => r.tools?.map((t) => t.function.name).join() === "search_pages,read_page"), "every turn declares the two tools");
  check(textOf(firstRequest.messages[0].content).includes("never instructions"), "the system prompt treats page content as data");
  check(fake.chats.every((r) => !secrets.some((s) => everything(r).includes(s))), "nothing from pages the person can't open is ever sent to the model");
  check(!questionSources.some((s) => s.pageId === theirs.id), "…nor another workspace's pages");

  const conversationId = first.conversationId!;
  const listed = await listConversations(alice, workspaceId);
  check(listed.length === 1 && listed[0].id === conversationId && listed[0].title.startsWith("Which automobile"), "the conversation is kept, titled by its question", listed);
  const shown = await getConversation(alice, workspaceId, conversationId);
  check(
    shown.messages.length === 2 && shown.messages[1].content === first.text && shown.messages[1].sources?.[0]?.pageId === vendors.id,
    "…with the answer and its sources",
    shown,
  );
  check((await listConversations(bob, workspaceId)).length === 0, "other people don't see it in their list");
  check((await getConversation(bob, workspaceId, conversationId).catch((e) => e)) instanceof AccessError, "…nor can they open it by id");
  check((await refusal(() => startChat(bob, { workspaceId, conversationId, message: "More?" }))) === "noAccess", "…or continue it");
  await deleteConversations(bob, workspaceId, [conversationId]);
  check((await listConversations(alice, workspaceId)).length === 1, "…or delete it");

  // A follow-up carries the earlier turn, without its citation numbers.
  fake.setChat(researcher({}));
  fake.chats.length = 0;
  const followUp = await ask(alice, { workspaceId, conversationId, message: "And the office rules?" });
  check(followUp.done && followUp.conversationId === conversationId, "a follow-up continues the conversation");
  const history = fake.chats[0].messages.filter((m) => m.role !== "system").map((m) => `${m.role}:${textOf(m.content).slice(0, 40)}`);
  check(
    history[0] === "user:Which automobile needs tyres, and who se" && history[1] === "assistant:The answer is in Tyre vendors." && history.length === 3,
    "…with the earlier question and answer sent back (citations left out)",
    history,
  );
  check((await getConversation(alice, workspaceId, conversationId)).messages.length === 4, "…and both turns kept");

  // ── Access on every tool call ───────────────────────────────────────────────────────────────
  for (const [who, target, label] of [
    [alice, diary.id, "a private page shared with nobody"],
    [alice, roadmap.id, "a private teamspace's page"],
    [carol, travel.id, "a page shared with a group they're not in"],
    [guest, fleet.id, "a page not shared with the guest"],
    [alice, theirs.id, "another workspace's page"],
    [alice, "not-a-page", "a made-up id"],
  ] as const) {
    fake.setChat(researcher({ readId: target }));
    fake.chats.length = 0;
    const run = await ask(who, { workspaceId, message: "Tell me about automobile plans and vacation" });
    const results = fake.chats.flatMap(toolResults);
    check(
      run.done && results.some((r) => r.startsWith("No page with that id can be read")) && !run.tools.some((t) => t.startsWith("read_page")),
      `read_page refuses ${label}`,
      { results, tools: run.tools },
    );
    check(
      !run.sources.some((s) => s.pageId === target) && fake.chats.every((r) => !secrets.concat(who === carol ? ["SECRET-TRAVEL"] : []).some((s) => everything(r).includes(s))),
      "…and nothing of it reaches the model or the citations",
    );
  }
  fake.setChat(researcher({ readId: travel.id }));
  fake.chats.length = 0;
  const bobRead = await ask(bob, { workspaceId, message: "Where do vacation requests go?" });
  check(bobRead.sources.some((s) => s.pageId === travel.id) && fake.chats.some((r) => everything(r).includes("SECRET-TRAVEL")), "a group member can have the group's page read and cited");
  fake.setChat(researcher({}));
  fake.chats.length = 0;
  const guestRun = await ask(guest, { workspaceId, message: "When is the holiday calendar? Also automobile tyres." });
  const guestSources = fake.chats.flatMap(sourcesIn).map((s) => s.pageId);
  check(guestRun.done && guestSources.includes(guestBook.id) && guestSources.every((id) => id === guestBook.id), "a guest's questions are answered only from pages shared with them", guestSources);

  // Access taken back between two questions.
  fake.setChat(researcher({ readId: lent.id }));
  const lentRun = await ask(alice, { workspaceId, message: "What is the vehicle budget?" });
  check(lentRun.sources.some((s) => s.pageId === lent.id && s.title === "Lent budget"), "a page shared with someone is read and cited");
  await removePagePermission(owner, lent.id, alice);
  const lentShown = await getConversation(alice, workspaceId, lentRun.conversationId!);
  const lentSource = lentShown.messages[1].sources?.[0];
  check(lentSource?.pageId === null && lentSource.title === null, "once access is taken back, the old citation no longer names the page", lentSource);
  fake.chats.length = 0;
  const lentAgain = await ask(alice, { workspaceId, conversationId: lentRun.conversationId, message: "Read it again, please." });
  check(
    fake.chats.flatMap(toolResults).some((r) => r.startsWith("No page with that id can be read")) && !lentAgain.sources.some((s) => s.pageId === lent.id),
    "…and it can't be read again in the same conversation",
  );
  check(fake.chats.every((r) => !everything(r).includes("SECRET-LENT")), "…nor its text found by search any more");

  // ── Scope ───────────────────────────────────────────────────────────────────────────────────
  fake.setChat(researcher({ search: "puppies", readId: office.id }));
  fake.chats.length = 0;
  const scoped = await ask(alice, { workspaceId, message: "What do we know about the automobile?", scope: { pageId: fleet.id } });
  const scopedSources = fake.chats.flatMap(sourcesIn).map((s) => s.pageId);
  check(scoped.done && scopedSources.length > 0 && scopedSources.every((id) => id === fleet.id || id === vendors.id), "a question about a page searches only it and its subpages", scopedSources);
  check(fake.chats.flatMap(toolResults).some((r) => r.startsWith("No page with that id")), "…and read_page refuses pages outside it");
  check(textOf(fake.chats[0].messages[0].content).includes('Only the page "Fleet notes"'), "…the model is told the scope");
  check((await refusal(() => startChat(alice, { workspaceId, message: "x?", scope: { pageId: diary.id } }))) === "noAccess", "a page the person can't open can't be the scope");
  check((await refusal(() => startChat(outsider, { workspaceId: otherWs, message: "x?", scope: { pageId: fleet.id } }))) === "noAccess", "…nor another workspace's page");

  // ── Stopping, limits, failures ──────────────────────────────────────────────────────────────
  fake.setChat(() => ({ text: "This is a long answer that goes on and on for quite a while before it ends [1]." }));
  fake.delayMs = 40;
  const controller = new AbortController();
  let pieces = 0;
  const stopped = await ask(dave, { workspaceId, message: "Tell me a long story about tyres" }, {
    signal: controller.signal,
    onEvent: (e) => {
      if (e.type === "text" && ++pieces === 3) controller.abort();
    },
  });
  fake.delayMs = 0;
  check(stopped.error === "aborted" && stopped.text.length > 0 && !stopped.text.endsWith("ends [1]."), "an answer can be stopped midway", stopped);
  const stoppedShown = await getConversation(dave, workspaceId, stopped.conversationId!);
  check(stoppedShown.messages[1]?.note === "stopped" && stoppedShown.messages[1].content === stopped.text, "…what was written so far is kept, marked as stopped", stoppedShown);

  fake.setChat(() => {
    throw new Error("model down");
  });
  const before = (await listConversations(dave, workspaceId)).length;
  const failed = await ask(dave, { workspaceId, message: "Anything about tyres?" });
  check(failed.error !== null && !failed.done, "a failing provider ends the answer with an error", failed.events);
  check((await listConversations(dave, workspaceId)).length === before, "…and leaves no empty conversation behind");

  let rounds = 0;
  fake.setChat(() => {
    rounds++;
    return { text: rounds === MAX_ROUNDS ? "Enough: see [1]." : "", toolCalls: [{ name: "search_pages", arguments: { query: `tyres ${rounds}` } }] };
  });
  fake.chats.length = 0;
  const looping = await ask(dave, { workspaceId, message: "Search forever about tyres" });
  check(looping.done && fake.chats.length === MAX_ROUNDS && looping.text === "Enough: see [1].", `a model that keeps calling tools gets ${MAX_ROUNDS} turns, the last one's text is the answer`, {
    turns: fake.chats.length,
    text: looping.text,
  });
  check(toolResults(fake.chats[MAX_ROUNDS - 1]).at(-1)?.includes("answer now"), "…and it's told to answer before its last turn");

  check((await refusal(() => startChat(dave, { workspaceId, message: "x".repeat(MAX_CHAT_MESSAGE + 1) }))) === "tooLarge", "a question longer than the limit is refused");
  check((await refusal(() => startChat(dave, { workspaceId, message: "   " }))) === "invalid", "an empty question is refused");
  const [full] = await db
    .insert(aiConversation)
    .values({
      userId: dave,
      workspaceId,
      title: "Full",
      messages: Array.from({ length: MAX_CHAT_TURNS }, () => [
        { role: "user" as const, content: "q", at: "" },
        { role: "assistant" as const, content: "a", at: "" },
      ]).flat(),
    })
    .returning();
  check((await refusal(() => startChat(dave, { workspaceId, conversationId: full.id, message: "One more?" }))) === "tooLarge", `a conversation takes at most ${MAX_CHAT_TURNS} questions`);
  setAiEnv({ ...AI, AI_RATE_LIMIT: "2" });
  fake.setChat(researcher({}));
  const limited: (string | null)[] = [];
  for (let i = 0; i < 3; i++) limited.push(await refusal(async () => ask(carol, { workspaceId, message: `Tyres ${i}?` })));
  check(limited.join() === ",,rateLimited", "questions count against the person's AI rate limit", limited);
  setAiEnv(AI);

  check((await refusal(() => startChat(outsider, { workspaceId, message: "Tyres?" }))) === "noAccess", "people outside the workspace can't ask");
  check((await refusal(() => startChat(alice, { workspaceId, conversationId: full.id, message: "Mine?" }))) === "noAccess", "…nor anyone continue another person's conversation");

  // ── The switches ────────────────────────────────────────────────────────────────────────────
  await updateWorkspaceSettings(owner, workspaceId, { ai: false });
  check((await refusal(() => startChat(alice, { workspaceId, message: "Tyres?" }))) === "disabled", "with AI off for the workspace the chat is off");
  await updateWorkspaceSettings(owner, workspaceId, { ai: true });
  setAiEnv({ AI_EMBEDDINGS_MODEL: "fake-embed", AI_EMBEDDINGS_BASE_URL: fake.baseUrl, AI_EMBEDDINGS_API_KEY: "local-test" });
  check((await refusal(() => startChat(alice, { workspaceId, message: "Tyres?" }))) === "disabled", "with embeddings but no chat model the chat is off");
  setAiEnv({ AI_PROVIDER: AI.AI_PROVIDER, AI_MODEL: AI.AI_MODEL, AI_BASE_URL: AI.AI_BASE_URL });
  fake.setChat(researcher({}));
  fake.chats.length = 0;
  const textOnly = await ask(alice, { workspaceId, message: "tyres" });
  check(textOnly.done && sourcesIn(fake.chats[0]).some((s) => s.pageId === fleet.id), "without embeddings the chat answers from full-text search");
  setAiEnv(AI);

  // ── Deleting ────────────────────────────────────────────────────────────────────────────────
  const aliceBefore = await listConversations(alice, workspaceId);
  await deleteConversations(alice, workspaceId, [aliceBefore[0].id]);
  check((await listConversations(alice, workspaceId)).length === aliceBefore.length - 1, "a conversation can be deleted");
  await deleteConversations(alice, workspaceId, "all");
  check((await listConversations(alice, workspaceId)).length === 0, "…or all of them");
  check((await listConversations(dave, workspaceId)).length > 0, "…leaving other people's alone");
  await removeMember(owner, workspaceId, dave);
  const daveLeft = await db.select().from(aiConversation).where(and(eq(aiConversation.userId, dave), eq(aiConversation.workspaceId, workspaceId)));
  check(daveLeft.length === 0, "someone removed from the workspace loses their conversations there");
  const bobConversations = await listConversations(bob, workspaceId);
  await db.delete(user).where(eq(user.id, bob));
  const bobLeft = await db.select().from(aiConversation).where(inArray(aiConversation.id, bobConversations.map((c) => c.id)));
  check(bobConversations.length > 0 && bobLeft.length === 0, "a deleted account takes its conversations with it");

  console.log(`\n${passed} checks passed`);
} finally {
  resetAi();
  fake.delayMs = 0;
  await settle().catch(() => {});
  await db.delete(workspace).where(inArray(workspace.id, [workspaceId, otherWs]));
  await db.delete(user).where(inArray(user.id, userIds));
  await fake.close();
  hocuspocus.closeConnections();
  await (globalThis as unknown as { __esionageSql?: { end(): Promise<void> } }).__esionageSql?.end();
}

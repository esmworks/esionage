/**
 * AI chat over workspace pages (#41): answers a person's questions from the pages they can read,
 * citing them. Each question:
 *
 * 1. is checked (membership and the workspace's two-step policy, AI on in the workspace, the scope
 *    page readable, size and rate limits) before anything is sent;
 * 2. is searched for (hybrid full-text and semantic search, pages.searchPages) and goes to the model
 *    with the best passages, numbered;
 * 3. may make the model call `search_pages` and `read_page`, which run as the person through
 *    operations.ts with their access checked on every call: a page they lost access to since
 *    can't be read, whatever the conversation said before;
 * 4. streams the answer; citations ([n]) link to the pages (and the block a passage starts at).
 *
 * Conversations are kept per person (ai_conversation) and only ever shown to them; cited pages are
 * looked up again with their current access whenever a conversation is shown.
 */
import { and, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { aiConversation, page, type ChatMessageRecord, type ChatSourceRef } from "@/db/schema";
import type { AiErrorCode } from "@/lib/ai";
import {
  citedNumbers,
  conversationTitle,
  MAX_CHAT_MESSAGE,
  MAX_CHAT_TURNS,
  MAX_CONVERSATIONS,
  type ChatEvent,
  type ChatMessageView,
  type ChatScope,
  type ChatSourceView,
  type ConversationSummary,
} from "@/lib/ai-chat";
import { pageLabel } from "@/lib/labels";
import { AccessError, pageAccessOf, requireMembership, requirePageAccess } from "@/server/access";
import { aiConfig, AiError, isAiError, stream, takeRateLimit, takeWorkspaceCapacity, type AiMessage, type AiTool } from "@/server/ai";
import { chatHistory, chatQuestionPrompt, chatSystemPrompt, formatSources, truncateText, type ChatSourceText } from "@/server/ai/prompts";
import { aiAvailable } from "@/server/ai-writing";
import * as ops from "@/server/operations";
import { inSubtree } from "@/server/semantic-search";

/** Model turns per question: searches and reads, then the answer. */
export const MAX_ROUNDS = 5;
/** Passages sent with a question, and results of one search. */
const PASSAGES = 6;
const PASSAGE_CHARS = 1_200;
/** The most of a page one read_page call returns. */
const PAGE_CHARS = 12_000;
/** Share of the prompt that earlier questions and answers may take. */
const HISTORY_SHARE = 0.25;

export const CHAT_TOOLS: AiTool[] = [
  {
    name: "search_pages",
    description:
      "Searches the workspace's pages the person can read, by words and by meaning. Returns numbered sources with the best matching passage of each page.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "What to look for: words, names or a short description." } },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "read_page",
    description: "Reads a whole page (its text, or a database row's values) by the page_id of a source. Returns it as a numbered source.",
    parameters: {
      type: "object",
      properties: { page_id: { type: "string", description: "The page_id attribute of a source." } },
      required: ["page_id"],
      additionalProperties: false,
    },
  },
];

export type ChatInput = {
  workspaceId: string;
  /** Continues this conversation; a new one starts without. */
  conversationId?: string | null;
  message: string;
  scope?: ChatScope;
};

/** Refusals before anything is sent: access problems look like missing things. */
function refuse(code: AiErrorCode, message: string): never {
  throw new AiError(code, message);
}

async function scopePage(userId: string, workspaceId: string, scope: ChatScope | undefined) {
  if (!scope) return null;
  const found = await requirePageAccess(userId, scope.pageId, "view").catch((error) => {
    if (error instanceof AccessError && error.name !== "TwoFactorRequiredError") refuse("noAccess", "Page not found");
    throw error;
  });
  if (found.workspaceId !== workspaceId || found.archivedAt || found.inTemplate) refuse("noAccess", "Page not found");
  return found;
}

/** The person's conversation (theirs, in this workspace), or noAccess. */
async function ownConversation(userId: string, workspaceId: string, conversationId: string) {
  const [found] = await db
    .select()
    .from(aiConversation)
    .where(and(eq(aiConversation.id, conversationId), eq(aiConversation.userId, userId), eq(aiConversation.workspaceId, workspaceId)))
    .limit(1);
  if (!found) refuse("noAccess", "Conversation not found");
  return found;
}

/** Characters a list of messages takes in a prompt (as the AI layer counts them). */
const sizeOf = (messages: AiMessage[]) => messages.reduce((n, m) => n + m.content.length, 0);

/**
 * Starts answering a question. Checks and limits run first and throw AiError (nothing is sent
 * then); the returned events stream the work. `signal` cancels it: what was written so far is kept
 * in the conversation, marked as stopped.
 */
export async function startChat(userId: string, input: ChatInput, signal?: AbortSignal): Promise<AsyncIterable<ChatEvent>> {
  const message = input.message.trim();
  if (!message) refuse("invalid", "Ask a question");
  if (message.length > MAX_CHAT_MESSAGE) refuse("tooLarge", `A question may have at most ${MAX_CHAT_MESSAGE} characters`);
  await requireMembership(userId, input.workspaceId).catch((error) => {
    if (error instanceof AccessError && error.name !== "TwoFactorRequiredError") refuse("noAccess", "Workspace not found");
    throw error;
  });
  if (!(await aiAvailable(input.workspaceId))) refuse("disabled", "AI is off for this workspace");
  const scope = await scopePage(userId, input.workspaceId, input.scope);
  const existing = input.conversationId ? await ownConversation(userId, input.workspaceId, input.conversationId) : null;
  if (existing && existing.messages.filter((m) => m.role === "user").length >= MAX_CHAT_TURNS) {
    refuse("tooLarge", "This conversation is full; start a new one");
  }
  takeRateLimit({ userId, workspaceId: input.workspaceId });
  return runChat(userId, input.workspaceId, message, scope ? { id: scope.id, title: scope.title } : null, existing, signal);
}

type Registry = {
  sources: (ChatSourceText & { blockId: string | null })[];
  byKey: Map<string, number>;
};

function register(registry: Registry, source: { pageId: string; blockId: string | null; title: string; text: string; note?: string }) {
  const key = `${source.pageId}#${source.blockId ?? ""}`;
  const known = registry.byKey.get(key);
  if (known !== undefined) {
    // Read again (a longer text): the model sees it again under the same number.
    const entry = registry.sources[known - 1];
    return { ...entry, text: source.text, note: source.note };
  }
  const n = registry.sources.length + 1;
  const entry = { n, ...source };
  registry.sources.push(entry);
  registry.byKey.set(key, n);
  return entry;
}

async function* runChat(
  userId: string,
  workspaceId: string,
  message: string,
  scope: { id: string; title: string } | null,
  existing: typeof aiConversation.$inferSelect | null,
  signal?: AbortSignal,
): AsyncGenerator<ChatEvent> {
  const ctx: ops.OperationContext = { userId, actor: { userId } };
  const limits = aiConfig().limits;
  const system = chatSystemPrompt(scope ? pageLabel(scope.title) : null);
  const toolsSize = CHAT_TOOLS.reduce((n, t) => n + t.description.length + JSON.stringify(t.parameters).length, 0);
  const room = () => limits.maxInputChars - system.length - toolsSize - 200;

  const conversation =
    existing ??
    (
      await db
        .insert(aiConversation)
        .values({ userId, workspaceId, title: conversationTitle(message), messages: [] })
        .returning()
    )[0];
  yield { type: "conversation", id: conversation.id, title: conversation.title };

  const registry: Registry = { sources: [], byKey: new Map() };
  let answer = "";
  let stopReason: "stop" | "length" = "stop";
  let failure: AiErrorCode | null = null;
  try {
    // ---------------------------------------------------------------- retrieval for the question
    yield { type: "tool", name: "search_pages", detail: message };
    const history: AiMessage[] = chatHistory(existing?.messages ?? [], Math.floor(room() * HISTORY_SHARE));
    const passageRoom = Math.max(0, room() - sizeOf(history) - message.length - 500);
    const perPassage = Math.min(PASSAGE_CHARS, Math.floor(passageRoom / PASSAGES));
    const found = perPassage >= 200 ? await searchSources(ctx, workspaceId, scope?.id, message, registry, perPassage) : [];
    const messages: AiMessage[] = [...history, { role: "user", content: chatQuestionPrompt(message, found) }];

    // ------------------------------------------------------------------------------ model turns
    for (let round = 0; round < MAX_ROUNDS; round++) {
      if (round > 0) {
        const wait = takeWorkspaceCapacity(workspaceId);
        if (wait > 0) throw new AiError("rateLimited", "The workspace's AI allowance is used up for now", wait);
      }
      const last = round === MAX_ROUNDS - 1;
      const turn = stream({
        feature: "chat",
        userId,
        workspaceId,
        skipRateLimit: true,
        system,
        messages,
        // Tools stay declared (providers want them while the conversation has tool calls); the
        // last turn is told to answer instead, and what it writes is the answer.
        tools: CHAT_TOOLS,
        signal,
      });
      let streamed = "";
      for await (const event of turn) {
        streamed += event.delta;
        answer = streamed;
        yield { type: "text", text: event.delta };
      }
      const result = await turn.result();
      if (!result.toolCalls.length || last) {
        answer = result.text;
        stopReason = result.stopReason === "length" ? "length" : "stop";
        break;
      }
      // Text before a tool call is the model thinking aloud, not the answer.
      if (streamed) yield { type: "reset" };
      answer = "";
      messages.push(result.message);
      const answerNext = round === MAX_ROUNDS - 2;
      for (const call of result.toolCalls) {
        const left = room() - sizeOf(messages) - 300;
        const out = await runTool(ctx, workspaceId, scope?.id, call, registry, left);
        if (out.event) yield out.event;
        const content = answerNext ? `${out.content}\n\n(No more searching or reading: answer now with the sources you have.)` : out.content;
        messages.push({ role: "tool", toolCallId: call.id, name: call.name, content, isError: out.isError });
      }
    }
    if (!answer.trim()) throw new AiError("empty", "The model gave no answer");
  } catch (error) {
    failure = isAiError(error) ? error.code : "provider";
    if (!isAiError(error)) console.error("[ai] chat failed", error);
  }

  // ------------------------------------------------------------------------------ the answer
  const stopped = failure === "aborted" && answer.trim().length > 0;
  if (!failure || stopped) {
    const cited = new Set(citedNumbers(answer));
    const refs: ChatSourceRef[] = registry.sources.filter((s) => cited.has(s.n)).map((s) => ({ n: s.n, pageId: s.pageId, blockId: s.blockId }));
    const now = new Date().toISOString();
    const note = stopped ? "stopped" : stopReason === "length" ? "cutOff" : undefined;
    await saveTurn(conversation.id, [
      { role: "user", content: message, at: now },
      { role: "assistant", content: answer, sources: refs, ...(note ? { note } : {}), at: now },
    ]);
    await pruneConversations(userId, workspaceId);
    yield { type: "sources", sources: await viewSources(userId, refs) };
    if (!failure) yield { type: "done", stopReason };
    else yield { type: "error", code: failure };
    return;
  }
  // Nothing to keep: a conversation this question started goes again.
  if (!existing) await db.delete(aiConversation).where(and(eq(aiConversation.id, conversation.id), sql`jsonb_array_length(${aiConversation.messages}) = 0`));
  yield { type: "error", code: failure };
}

// ------------------------------------------------------------------------------------ tools

/** Searches as the person (their access checked now) and registers the results as sources. */
async function searchSources(
  ctx: ops.OperationContext,
  workspaceId: string,
  scopeId: string | undefined,
  query: string,
  registry: Registry,
  maxChars: number,
) {
  const { results } = await ops.search(ctx, { query, workspace_id: workspaceId, limit: PASSAGES }, { withinPageId: scopeId, passages: true });
  return results.map((r) =>
    register(registry, {
      pageId: r.id,
      blockId: r.passage ? (r.block_id ?? null) : null,
      title: r.title,
      text: truncateText(r.passage || r.snippet || "", maxChars),
    }),
  );
}

type ToolOutcome = { content: string; isError?: boolean; event?: ChatEvent };

async function runTool(
  ctx: ops.OperationContext,
  workspaceId: string,
  scopeId: string | undefined,
  call: { name: string; arguments: Record<string, unknown> },
  registry: Registry,
  room: number,
): Promise<ToolOutcome> {
  if (room < 1_000) return { content: "There is no room left in this request to search or read more. Answer with what you have.", isError: true };
  if (call.name === "search_pages") {
    const query = typeof call.arguments.query === "string" ? call.arguments.query.trim().slice(0, 500) : "";
    if (!query) return { content: "search_pages needs a query.", isError: true };
    const found = await searchSources(ctx, workspaceId, scopeId, query, registry, Math.min(PASSAGE_CHARS, Math.floor(room / PASSAGES)));
    return {
      content: found.length ? formatSources(found) : "Nothing matched. Try other words, or answer that the workspace has nothing on it.",
      event: { type: "tool", name: "search_pages", detail: query },
    };
  }
  if (call.name === "read_page") {
    const pageId = typeof call.arguments.page_id === "string" ? call.arguments.page_id.trim() : "";
    const missing: ToolOutcome = { content: "No page with that id can be read. Use a page_id from a source.", isError: true };
    if (!pageId || pageId.length > 100) return missing;
    // Checked on every call, with the access the person has now.
    const read = await readPage(ctx, workspaceId, scopeId, pageId, Math.min(PAGE_CHARS, room - 500)).catch((error) => {
      if (error instanceof AccessError || (error as Error)?.name === "ToolInputError") return null;
      throw error;
    });
    if (!read) return missing;
    const entry = register(registry, { pageId, blockId: null, title: read.title, text: read.text, note: read.note });
    return { content: formatSources([entry]), event: { type: "tool", name: "read_page", detail: pageLabel(read.title) } };
  }
  return { content: `Unknown tool ${call.name}.`, isError: true };
}

/** A page's text as the person may read it now, or null when it's out of reach or scope. */
async function readPage(ctx: ops.OperationContext, workspaceId: string, scopeId: string | undefined, pageId: string, maxChars: number) {
  if (scopeId) {
    const [inside] = await db.execute<{ one: number }>(sql`select 1 as one from ${page} p where p.id = ${pageId} and ${inSubtree(scopeId)}`);
    if (!inside) return null;
  }
  const out = (await ops.getPage(ctx, { page_id: pageId, offset: 0 }, { maxMarkdownChars: maxChars })) as Record<string, unknown>;
  if (out.workspace_id !== workspaceId || out.in_trash || out.template) return null;
  const parts: string[] = [];
  if (typeof out.path === "string") parts.push(`Path: ${out.path}`);
  if (out.properties && typeof out.properties === "object") {
    const lines = Object.entries(out.properties as Record<string, unknown>).map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
    if (lines.length) parts.push(lines.join("\n"));
  }
  if (Array.isArray(out.database_properties)) {
    parts.push(`A database with the properties: ${(out.database_properties as { name?: string }[]).map((p) => p.name).filter(Boolean).join(", ")}`);
  }
  if (typeof out.markdown === "string" && out.markdown.trim()) parts.push(out.markdown);
  return {
    title: String(out.title ?? ""),
    text: truncateText(parts.join("\n\n"), maxChars),
    note: out.markdown_truncated ? "Only the start of the page fits." : undefined,
  };
}

// ---------------------------------------------------------------------------- conversations

async function saveTurn(conversationId: string, records: ChatMessageRecord[]) {
  await db
    .update(aiConversation)
    .set({ messages: sql`${aiConversation.messages} || ${JSON.stringify(records)}::jsonb`, updatedAt: new Date() })
    .where(eq(aiConversation.id, conversationId));
}

/** Keeps the person's MAX_CONVERSATIONS most recent conversations in the workspace. */
async function pruneConversations(userId: string, workspaceId: string) {
  const keep = await db
    .select({ id: aiConversation.id })
    .from(aiConversation)
    .where(and(eq(aiConversation.userId, userId), eq(aiConversation.workspaceId, workspaceId)))
    .orderBy(desc(aiConversation.updatedAt))
    .limit(MAX_CONVERSATIONS);
  if (keep.length < MAX_CONVERSATIONS) return;
  await db.delete(aiConversation).where(
    and(
      eq(aiConversation.userId, userId),
      eq(aiConversation.workspaceId, workspaceId),
      notInArray(
        aiConversation.id,
        keep.map((k) => k.id),
      ),
    ),
  );
}

/** Cited pages as the person may see them now: pages they can't open lose id and title. */
export async function viewSources(userId: string, refs: ChatSourceRef[]): Promise<ChatSourceView[]> {
  const ids = [...new Set(refs.map((r) => r.pageId))];
  const visible = new Map<string, { title: string; icon: string | null; workspaceId: string }>();
  for (const id of ids) {
    const { page: found, level } = await pageAccessOf(userId, id);
    if (found && level !== "none" && !found.archivedAt && !found.inTemplate) {
      visible.set(id, { title: found.title, icon: found.icon, workspaceId: found.workspaceId });
    }
  }
  return refs.map((r) => {
    const seen = visible.get(r.pageId);
    return seen
      ? { n: r.n, pageId: r.pageId, workspaceId: seen.workspaceId, title: seen.title, icon: seen.icon, blockId: r.blockId }
      : { n: r.n, pageId: null, workspaceId: null, title: null, icon: null, blockId: null };
  });
}

/** The person's conversations in a workspace, newest first. */
export async function listConversations(userId: string, workspaceId: string): Promise<ConversationSummary[]> {
  await requireMembership(userId, workspaceId);
  const rows = await db
    .select({ id: aiConversation.id, title: aiConversation.title, updatedAt: aiConversation.updatedAt })
    .from(aiConversation)
    .where(and(eq(aiConversation.userId, userId), eq(aiConversation.workspaceId, workspaceId)))
    .orderBy(desc(aiConversation.updatedAt));
  return rows.map((r) => ({ id: r.id, title: r.title, updatedAt: r.updatedAt.toISOString() }));
}

/** One of the person's conversations, with its sources as they may see them now. */
export async function getConversation(userId: string, workspaceId: string, conversationId: string) {
  await requireMembership(userId, workspaceId);
  const found = await ownConversation(userId, workspaceId, conversationId).catch(() => {
    throw new AccessError();
  });
  const refs = found.messages.flatMap((m) => m.sources ?? []);
  const views = await viewSources(userId, refs);
  let i = 0;
  const messages: ChatMessageView[] = found.messages.map((m) => {
    const sources = m.sources?.map(() => views[i++]);
    return { role: m.role, content: m.content, ...(sources ? { sources } : {}), ...(m.note ? { note: m.note } : {}) };
  });
  return { id: found.id, title: found.title, messages };
}

/** Deletes conversations of the person (only theirs). */
export async function deleteConversations(userId: string, workspaceId: string, conversationIds: string[] | "all") {
  await requireMembership(userId, workspaceId);
  await db
    .delete(aiConversation)
    .where(
      and(
        eq(aiConversation.userId, userId),
        eq(aiConversation.workspaceId, workspaceId),
        conversationIds === "all" ? undefined : inArray(aiConversation.id, conversationIds.length ? conversationIds : [""]),
      ),
    );
}

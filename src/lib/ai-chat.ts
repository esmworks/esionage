// Client-safe: shared by the AI chat's server side (src/server/ai-chat.ts, /api/ai/chat) and its
// panel (src/components/ai-chat).

import type { AiErrorCode } from "./ai";

/** Longest question one message may ask. */
export const MAX_CHAT_MESSAGE = 4_000;
/** Questions one conversation may hold; then a new one starts. */
export const MAX_CHAT_TURNS = 40;
/** Conversations kept per person and workspace; the oldest go first. */
export const MAX_CONVERSATIONS = 50;

/** What the chat answers from: the whole workspace, or a page and the pages under it. */
export type ChatScope = { pageId: string } | null;

/** A source an answer cites, as the reader may see it now. */
export type ChatSourceView = {
  n: number;
  /** Null when the reader can no longer open the page (it's left out, title included). */
  pageId: string | null;
  workspaceId: string | null;
  title: string | null;
  icon: string | null;
  /** The block the cited passage starts at, when known. */
  blockId: string | null;
};

/** A page the chat read, as the reader may see it now (null: they can no longer open it). */
export type ChatPageView = { pageId: string; workspaceId: string; title: string; icon: string | null } | null;

/**
 * A step the chat took on the way to an answer (shown above it): a search (`query` null for the
 * search with the question itself) and how many pages it found, a page it read, or what the model
 * said before searching or reading.
 */
export type ChatStepView =
  | { kind: "search"; query: string | null; results: number }
  | { kind: "read"; page: ChatPageView }
  | { kind: "thought"; text: string };

export type ChatMessageView = {
  role: "user" | "assistant";
  content: string;
  sources?: ChatSourceView[];
  note?: "stopped" | "cutOff";
  /** Answers: the steps taken and how long the answer took (not kept before steps were). */
  steps?: ChatStepView[];
  ms?: number;
};

export type ConversationSummary = { id: string; title: string; updatedAt: string };

/**
 * Lines of `POST /api/ai/chat`'s newline-delimited JSON answer, in order: `conversation` (its id,
 * first), `step` for each step taken (the search with the question, then the model's searches and
 * reads, and what it said before them), `thinking` while the model works on a turn, `text` as the
 * answer streams (`reset` drops what was streamed before a tool call: it comes again as a
 * `thought` step), `sources` once the answer is complete, then `done` (with how long it took) or
 * `error`.
 */
export type ChatEvent =
  | { type: "conversation"; id: string; title: string }
  | { type: "thinking" }
  | { type: "step"; step: ChatStepView }
  | { type: "text"; text: string }
  | { type: "reset" }
  | { type: "sources"; sources: ChatSourceView[] }
  | { type: "done"; stopReason: "stop" | "length"; ms: number }
  | { type: "error"; code: AiErrorCode };

/** Source numbers an answer cites (`[1]`, `[2][3]`, `[1, 4]`), each once, in order. */
export function citedNumbers(text: string): number[] {
  const seen = new Set<number>();
  for (const match of text.matchAll(/\[(\d{1,3}(?:\s*,\s*\d{1,3})*)\]/g)) {
    for (const n of match[1].split(",")) seen.add(Number(n.trim()));
  }
  return [...seen];
}

/** An answer's text with its citations taken out (earlier answers sent back to the model). */
export function stripCitations(text: string): string {
  return text.replace(/\s?\[(\d{1,3}(?:\s*,\s*\d{1,3})*)\]/g, "");
}

/** Where the links citations become point (`[1](#cite-1)`), for the answer's renderer. */
export const CITE_HREF = "#cite-";

/**
 * An answer's markdown with each citation as a link to `#cite-<n>` (`[2, 3]` becomes two), which
 * the chat panel shows as a button to the source. Code, fenced (also still open while the answer
 * streams) or inline, stays as written, as do a real link's text and reference definitions.
 */
export function citationLinks(text: string): string {
  return text
    .split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g)
    .map((part, i) =>
      i % 2
        ? part
        : part.replace(/\[(\d{1,3}(?:\s*,\s*\d{1,3})*)\](?![(:])/g, (_, list: string) =>
            list
              .split(",")
              .map((n) => `[${n.trim()}](${CITE_HREF}${n.trim()})`)
              .join(""),
          ),
    )
    .join("");
}

/** The full-page chat, showing a conversation when given. */
export function chatPath(workspaceId: string, conversationId?: string | null): string {
  return `/w/${workspaceId}/ai${conversationId ? `?c=${encodeURIComponent(conversationId)}` : ""}`;
}

/** Whether a pathname is the workspace's full-page chat. */
export function isChatPath(pathname: string, workspaceId: string): boolean {
  return pathname === `/w/${workspaceId}/ai`;
}

/** The link to a cited passage: the page, scrolled to the block it starts at. */
export function sourceHref(source: Pick<ChatSourceView, "workspaceId" | "pageId" | "blockId">): string | null {
  if (!source.pageId || !source.workspaceId) return null;
  return `/w/${source.workspaceId}/p/${source.pageId}${source.blockId ? `#block-${source.blockId}` : ""}`;
}

/** A conversation's title: the start of its first question. */
export function conversationTitle(message: string): string {
  const flat = message.replace(/\s+/g, " ").trim();
  return flat.length > 80 ? `${flat.slice(0, 79).trimEnd()}…` : flat;
}

export type ConversationGroup = "today" | "yesterday" | "week" | "month" | "older";

/**
 * Conversations by when they were last added to, in the person's local days, newest first as they
 * come: today, yesterday, the 7 and 30 days before today, and older. Empty groups are left out.
 */
export function groupConversations<T extends Pick<ConversationSummary, "updatedAt">>(
  conversations: T[],
  now: Date,
): { group: ConversationGroup; conversations: T[] }[] {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const daysBefore = (days: number) => new Date(midnight.getFullYear(), midnight.getMonth(), midnight.getDate() - days).getTime();
  const bounds: [ConversationGroup, number][] = [
    ["today", midnight.getTime()],
    ["yesterday", daysBefore(1)],
    ["week", daysBefore(7)],
    ["month", daysBefore(30)],
  ];
  const groups = new Map<ConversationGroup, T[]>();
  for (const conversation of conversations) {
    const at = new Date(conversation.updatedAt).getTime();
    const group = bounds.find(([, from]) => at >= from)?.[0] ?? "older";
    groups.set(group, [...(groups.get(group) ?? []), conversation]);
  }
  return (["today", "yesterday", "week", "month", "older"] as const).flatMap((group) => {
    const list = groups.get(group);
    return list ? [{ group, conversations: list }] : [];
  });
}

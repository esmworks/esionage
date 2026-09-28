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

export type ChatMessageView = {
  role: "user" | "assistant";
  content: string;
  sources?: ChatSourceView[];
  note?: "stopped" | "cutOff";
};

export type ConversationSummary = { id: string; title: string; updatedAt: string };

/**
 * Lines of `POST /api/ai/chat`'s newline-delimited JSON answer, in order: `conversation` (its id,
 * first), `tool` whenever the assistant searches or reads, `text` as the answer streams (`reset`
 * drops what was streamed before a tool call), `sources` once the answer is complete, then
 * `done` or `error`.
 */
export type ChatEvent =
  | { type: "conversation"; id: string; title: string }
  | { type: "tool"; name: "search_pages" | "read_page"; detail: string }
  | { type: "text"; text: string }
  | { type: "reset" }
  | { type: "sources"; sources: ChatSourceView[] }
  | { type: "done"; stopReason: "stop" | "length" }
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

export type AnswerPart = { type: "text"; text: string } | { type: "cite"; n: number };

/** Splits an answer into text and citations, for showing citations as links. */
export function splitCitations(text: string): AnswerPart[] {
  const parts: AnswerPart[] = [];
  let last = 0;
  for (const match of text.matchAll(/\[(\d{1,3}(?:\s*,\s*\d{1,3})*)\]/g)) {
    if (match.index > last) parts.push({ type: "text", text: text.slice(last, match.index) });
    for (const n of match[1].split(",")) parts.push({ type: "cite", n: Number(n.trim()) });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ type: "text", text: text.slice(last) });
  return parts;
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

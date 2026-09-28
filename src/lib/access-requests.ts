import type { PageLevel } from "@/db/schema";

/** Longest message kept with an access request; longer ones are cut. */
export const ACCESS_REQUEST_MESSAGE_MAX = 500;

/**
 * How many times one person may ask for access within the window. Every ask counts, whether the
 * page exists or not and whether a request was already pending, so hitting the limit says nothing
 * about the pages asked for.
 */
export const ACCESS_REQUEST_LIMIT = { count: 10, windowMs: 60 * 60_000 } as const;

export type ApprovalLevel = Exclude<PageLevel, "none">;

export const APPROVAL_LEVELS: readonly ApprovalLevel[] = ["view", "comment", "edit", "full"];

export const isApprovalLevel = (value: unknown): value is ApprovalLevel =>
  typeof value === "string" && (APPROVAL_LEVELS as readonly string[]).includes(value);

/**
 * The message to keep with a request: trimmed, tabs as spaces, without other control characters
 * than line breaks, at most ACCESS_REQUEST_MESSAGE_MAX characters; null when nothing is left.
 */
export function cleanRequestMessage(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, " ")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .trim();
  if (!text) return null;
  return [...text].slice(0, ACCESS_REQUEST_MESSAGE_MAX).join("").trimEnd();
}

/**
 * The page id when `path` (the requested path, see src/proxy.ts) is a page of the workspace:
 * `/w/<workspaceId>/p/<pageId>`, with or without a query. The workspace layout uses it to let
 * people outside the workspace reach the "You don't have access" screen, and nothing else.
 */
export function requestedPageId(path: string | null | undefined, workspaceId: string): string | null {
  if (!path) return null;
  const pathname = path.split(/[?#]/, 1)[0];
  const match = /^\/w\/([^/]+)\/p\/([^/]+)\/?$/.exec(pathname);
  if (!match) return null;
  let ws: string;
  let pageId: string;
  try {
    ws = decodeURIComponent(match[1]);
    pageId = decodeURIComponent(match[2]);
  } catch {
    return null;
  }
  return ws === workspaceId && pageId ? pageId : null;
}

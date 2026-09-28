import type { CallToolResult } from "@modelcontextprotocol/server";
import { CommentError } from "@/lib/comments";
import { env } from "@/lib/env";
import { PropertyValueError } from "@/lib/properties";
import { AccessError } from "@/server/access";
import { GroupError } from "@/lib/groups";
import { TeamspaceError } from "@/lib/teamspace-error";

/** Max characters of page markdown returned in one get_page call. */
export const MAX_MARKDOWN_CHARS = 30_000;

/** A problem with the tool arguments the model can fix by itself. */
export class ToolInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolInputError";
  }
}

export const pageUrl = (workspaceId: string, pageId: string) => `${env.appUrl}/w/${workspaceId}/p/${pageId}`;

export function jsonResult(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

export function errorResult(message: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: message }] };
}

/** Turns domain errors into tool errors the model can act on; unknown errors stay opaque. */
export function toolErrorFor(error: unknown): CallToolResult {
  if (error instanceof ToolInputError) return errorResult(error.message);
  if (error instanceof AccessError) {
    return errorResult(
      `${error.message}. The id may be wrong, deleted, or in a workspace this user cannot access. ` +
        "Use search, list_workspaces or list_pages to find valid ids.",
    );
  }
  if (error instanceof CommentError) return errorResult(`${error.message}.`);
  if (error instanceof TeamspaceError) return errorResult(`${error.message} Call list_teamspaces to see which teamspaces the user is in.`);
  if (error instanceof GroupError) return errorResult(`${error.message} Call list_groups to see the workspace's groups.`);
  if (error instanceof PropertyValueError) {
    return errorResult(`${error.message}. Call get_database to see property names, types and select options.`);
  }
  console.error("[mcp] tool failed", error);
  return errorResult("Something went wrong on the Esionage server while running this tool. Try again later.");
}

export async function runTool(fn: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return jsonResult(await fn());
  } catch (error) {
    return toolErrorFor(error);
  }
}

/** Returns a window of `text` starting at `offset`, bounded to `max` characters. */
export function sliceText(text: string, offset = 0, max = MAX_MARKDOWN_CHARS) {
  const start = Math.max(0, Math.min(offset, text.length));
  const end = Math.min(text.length, start + max);
  const truncated = start > 0 || end < text.length;
  return {
    text: text.slice(start, end),
    truncated,
    totalChars: text.length,
    ...(end < text.length
      ? { note: `Showing characters ${start}-${end} of ${text.length}. Call again with offset=${end} to read more.` }
      : start > 0
        ? { note: `Showing characters ${start}-${end} of ${text.length}.` }
        : {}),
  };
}

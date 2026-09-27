import { FILES_SCOPE, NOTIFICATIONS_SCOPE, READ_SCOPE, WRITE_SCOPE } from "@/server/mcp/principal";

export type ScopeKey = "openid" | "profile" | "email" | "offlineAccess" | "pagesRead" | "pagesWrite" | "notificationsRead" | "filesWrite";

/**
 * Message keys (under `consent.scopes`) for the OAuth scopes we can describe. The UI translates
 * these; `describeScope` in the MCP server keeps its English labels.
 */
const SCOPE_KEYS: Record<string, ScopeKey> = {
  openid: "openid",
  profile: "profile",
  email: "email",
  offline_access: "offlineAccess",
  [READ_SCOPE]: "pagesRead",
  [WRITE_SCOPE]: "pagesWrite",
  [NOTIFICATIONS_SCOPE]: "notificationsRead",
  [FILES_SCOPE]: "filesWrite",
};

/** The message key for a scope, or null for an unknown scope (shown as its raw name). */
export function scopeKey(scope: string): ScopeKey | null {
  return Object.hasOwn(SCOPE_KEYS, scope) ? SCOPE_KEYS[scope] : null;
}

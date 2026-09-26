import type { AuthInfo } from "@modelcontextprotocol/server";

export const READ_SCOPE = "pages:read";
export const WRITE_SCOPE = "pages:write";

/** The user and OAuth client an MCP request acts for. */
export type McpPrincipal = { userId: string; clientId: string; scopes: string[] };

/** The subset of verified access-token claims the MCP endpoint relies on. */
export type AccessTokenClaims = {
  sub?: string;
  scope?: unknown;
  client_id?: unknown;
  azp?: unknown;
  exp?: number;
  iat?: number;
};

export function parseScopes(scope: unknown): string[] {
  return typeof scope === "string" ? scope.split(" ").filter(Boolean) : [];
}

export function bearerToken(request: Request): string {
  const header = request.headers.get("authorization") ?? "";
  return header.replace(/^(Bearer|DPoP)\s+/i, "").trim();
}

/**
 * Maps verified JWT claims to the SDK's AuthInfo. `sub` is the user id (public subject
 * type); `client_id`/`azp` name the OAuth client the user authorized.
 */
export function authInfoFromClaims(claims: AccessTokenClaims, token: string, resource: string): AuthInfo | null {
  const clientId = typeof claims.client_id === "string" ? claims.client_id : typeof claims.azp === "string" ? claims.azp : "";
  if (!claims.sub || !clientId) return null;
  return {
    token,
    clientId,
    scopes: parseScopes(claims.scope),
    expiresAt: claims.exp,
    resource: new URL(resource),
    resourceMetadataUrl: protectedResourceMetadataUrl(resource),
    extra: { userId: claims.sub, issuedAt: claims.iat },
  };
}

export function principalFromAuthInfo(authInfo: AuthInfo | undefined): McpPrincipal {
  const userId = authInfo?.extra?.userId;
  if (!authInfo || typeof userId !== "string") throw new Error("MCP request without verified authentication");
  return { userId, clientId: authInfo.clientId, scopes: authInfo.scopes };
}

/** RFC 9728 metadata URL for a resource: `/.well-known/oauth-protected-resource` + resource path. */
export function protectedResourceMetadataUrl(resource: string): string {
  const url = new URL(resource);
  const path = url.pathname === "/" ? "" : url.pathname;
  return `${url.origin}/.well-known/oauth-protected-resource${path}`;
}

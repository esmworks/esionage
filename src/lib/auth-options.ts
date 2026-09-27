import type { BetterAuthOptions } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { jwt } from "better-auth/plugins";
import { mcp } from "@better-auth/mcp";
import { cimd } from "@better-auth/cimd";
import { fetchClientMetadataResource } from "@better-auth/cimd/node";
import { env, mcpResource } from "@/lib/env";

export const MCP_SCOPES = ["pages:read", "pages:write", "notifications:read"] as const;
const OAUTH_SCOPES = ["openid", "profile", "email", "offline_access", ...MCP_SCOPES];

/** http on an exact loopback host, or a private-use scheme: redirects only a native app can receive. */
function isNativeRedirect(uri: unknown) {
  if (typeof uri !== "string") return false;
  try {
    const url = new URL(uri);
    if (url.protocol === "https:") return false;
    if (url.protocol === "http:") return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    return true;
  } catch {
    return false;
  }
}

type AuthContextLike = { query?: unknown; request?: Request } | null | undefined;

function queryParam(ctx: AuthContextLike, name: string) {
  const fromQuery = (ctx?.query as Record<string, unknown> | undefined)?.[name];
  if (typeof fromQuery === "string") return fromQuery;
  if (!ctx?.request) return null;
  return new URL(ctx.request.url).searchParams.get(name);
}

/** The `?invite=` token of an auth request (sign-up from an invitation link). */
export const inviteTokenOf = (ctx: AuthContextLike) => queryParam(ctx, "invite");

/** The `?join=` token of an auth request (sign-up from a workspace's join link). */
export const joinTokenOf = (ctx: AuthContextLike) => queryParam(ctx, "join");

/** Checks an invitation link against the email signing up; injected so this file needs no database. */
export type InvitationCheck = (token: string, email: string) => Promise<boolean>;

export function baseAuthOptions({ invitationAllowsSignUp }: { invitationAllowsSignUp?: InvitationCheck } = {}) {
  const before = createAuthMiddleware(async (ctx) => {
    if (ctx.path === "/sign-up/email" && env.signUpDisabled) {
      // Closed sign-up still admits people holding an invitation link for their email.
      const token = inviteTokenOf(ctx);
      const email = (ctx.body as { email?: unknown } | undefined)?.email;
      const allowed =
        token && typeof email === "string" && invitationAllowsSignUp && (await invitationAllowsSignUp(token, email));
      if (!allowed) {
        throw APIError.from("BAD_REQUEST", {
          message: "Email and password sign up is not enabled",
          code: "EMAIL_PASSWORD_SIGN_UP_DISABLED",
        });
      }
    }
    // RFC 7591 defaults `application_type` to "web", which forbids loopback redirects. Desktop and
    // CLI MCP clients often register loopback callbacks without sending the field, so infer
    // "native" for them; the provider still validates every redirect URI for that type.
    if (ctx.path !== "/oauth2/register") return;
    const body = ctx.body as { application_type?: unknown; redirect_uris?: unknown } | undefined;
    if (!body || body.application_type !== undefined) return;
    const uris = body.redirect_uris;
    if (!Array.isArray(uris) || uris.length === 0 || !uris.every(isNativeRedirect)) return;
    return { context: { body: { ...body, application_type: "native" } } };
  });

  // Database-independent options, shared by the app and the schema generator.
  return {
    baseURL: env.appUrl,
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
    },
    hooks: { before },
    plugins: [
      jwt(),
      mcp({
        loginPage: "/sign-in",
        consentPage: "/oauth/consent",
        resource: mcpResource(),
        scopes: OAUTH_SCOPES,
        clientRegistrationDefaultScopes: OAUTH_SCOPES,
        clientRegistrationAllowedScopes: OAUTH_SCOPES,
        // MCP 2026-07-28 clients use CIMD; many deployed clients still register via DCR.
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
        clientRegistrationRequirePKCE: true,
      }),
      cimd({
        fetchClientMetadataResource,
        metadataProfile: "mcp-2026-07-28",
      }),
    ],
  } satisfies BetterAuthOptions;
}

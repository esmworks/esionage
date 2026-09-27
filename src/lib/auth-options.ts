import type { BetterAuthOptions, GenericEndpointContext } from "better-auth";
import { addOAuthServerContext, APIError, createAuthMiddleware, getOAuthState } from "better-auth/api";
import { jwt } from "better-auth/plugins";
import { mcp } from "@better-auth/mcp";
import { cimd } from "@better-auth/cimd";
import { fetchClientMetadataResource } from "@better-auth/cimd/node";
import { env, mcpResource } from "@/lib/env";
import type { SocialCredentials, SocialProvider } from "@/lib/social-providers";

export const MCP_SCOPES = ["pages:read", "pages:write", "notifications:read", "files:write"] as const;
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

/**
 * The `invite` / `join` token a social sign-in carried through the provider redirect, from the
 * OAuth state's server context (see the `/sign-in/social` hook below).
 */
export function socialTokenOf(serverContext: unknown, name: "invite" | "join") {
  const value = (serverContext as Record<string, unknown> | null | undefined)?.[name];
  return typeof value === "string" && value ? value : null;
}

/** The token a new user signed up with: the request query for email sign-up, the OAuth state for social. */
export async function signUpTokenOf(ctx: AuthContextLike, name: "invite" | "join") {
  return queryParam(ctx, name) ?? socialTokenOf((await getOAuthState())?.serverContext, name);
}

/** Checks an invitation link against the email signing up; injected so this file needs no database. */
export type InvitationCheck = (token: string, email: string) => Promise<boolean>;

/** Closed sign-up still admits people holding an invitation link for their email. */
export async function closedSignUpAdmits(token: string | null, email: unknown, check?: InvitationCheck) {
  return Boolean(token && typeof email === "string" && check && (await check(token, email)));
}

/**
 * `databaseHooks.user.create.before`. Social sign-in creates its user in the OAuth callback, past
 * the /sign-up/email check in baseAuthOptions, so closed sign-up is enforced here for every other
 * way in: only an invitation for the same email, carried through the OAuth state, admits one.
 */
export function closedSignUpGuard(check?: InvitationCheck) {
  return async (user: { email: string }, ctx: { path?: string } | null | undefined) => {
    if (!env.signUpDisabled || ctx?.path === "/sign-up/email") return;
    const invite = socialTokenOf((await getOAuthState())?.serverContext, "invite");
    if (await closedSignUpAdmits(invite, user.email, check)) return;
    throw APIError.from("FORBIDDEN", { message: "Sign up is not enabled", code: "signup_disabled" });
  };
}

/**
 * `databaseHooks.account.create.after`. Anyone could have created a password account with someone
 * else's unverified email beforehand (pre-account-takeover). When a sign-in links a provider
 * account to such a user by email, the provider has just proven who owns the address, so the
 * earlier password, sessions and app grants go; the owner can set a password by resetting it by
 * email. Better Auth links the account before it creates the new session, so that one survives.
 */
export function claimOnEmailLink(revokeAppGrants?: (userId: string) => Promise<void>) {
  return async (account: { id: string; userId: string; providerId: string }, ctx: GenericEndpointContext | null) => {
    if (!ctx || account.providerId === "credential") return;
    // An explicit /link-social by the signed-in user, not a link by email.
    if ((await getOAuthState())?.link) return;
    const adapter = ctx.context.internalAdapter;
    const user = await adapter.findUserById(account.userId);
    if (!user || user.emailVerified) return;
    const others = (await adapter.findAccounts(account.userId)).filter((other) => other.id !== account.id);
    // No other account: the user was created by this same sign-in, there is nothing to claim.
    if (others.length === 0) return;
    for (const other of others) if (other.providerId === "credential") await adapter.deleteAccount(other.id);
    await adapter.deleteUserSessions(account.userId);
    await revokeAppGrants?.(account.userId);
    await adapter.updateUser(account.userId, { emailVerified: true });
  };
}

/** Sign-in with the providers configured in the environment, and linking them to existing accounts. */
export function socialAuthOptions(providers: Partial<Record<SocialProvider, SocialCredentials>>) {
  return {
    socialProviders: {
      ...(providers.github && { github: providers.github }),
      ...(providers.google && { google: { ...providers.google, prompt: "select_account" as const } }),
    },
    account: {
      accountLinking: {
        enabled: true,
        // A provider account joins the existing account with its email when the provider says the
        // address is verified (neither is trusted blindly). Email/password sign-up never verifies
        // addresses, so requiring that on our side would keep every existing account from linking;
        // claimOnEmailLink handles what such an unverified account may carry.
        requireLocalEmailVerified: false,
      },
    },
  } satisfies BetterAuthOptions;
}

export function baseAuthOptions({ invitationAllowsSignUp }: { invitationAllowsSignUp?: InvitationCheck } = {}) {
  const before = createAuthMiddleware(async (ctx) => {
    if (ctx.path === "/sign-up/email" && env.signUpDisabled) {
      const email = (ctx.body as { email?: unknown } | undefined)?.email;
      if (!(await closedSignUpAdmits(inviteTokenOf(ctx), email, invitationAllowsSignUp))) {
        throw APIError.from("BAD_REQUEST", {
          message: "Email and password sign up is not enabled",
          code: "EMAIL_PASSWORD_SIGN_UP_DISABLED",
        });
      }
    }
    // The provider redirects back to /callback without our query, so an invitation or join link
    // rides the server-side OAuth state; the user-create hooks in auth.ts read it back from there.
    if (ctx.path === "/sign-in/social") {
      const invite = inviteTokenOf(ctx);
      const join = joinTokenOf(ctx);
      if (invite || join) await addOAuthServerContext({ ...(invite && { invite }), ...(join && { join }) });
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

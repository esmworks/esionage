import type { BetterAuthPlugin } from "better-auth";
import { addOAuthServerContext, APIError, createAuthMiddleware, getOAuthState, getSessionFromCtx } from "better-auth/api";
import { symmetricDecrypt } from "better-auth/crypto";
import { twoFactor } from "better-auth/plugins";
import { passkey } from "@better-auth/passkey";
import { verifyTotp } from "@/lib/totp";

/**
 * Two-step verification (authenticator app codes plus one-time recovery codes) and passkeys.
 * Database-independent like the rest of baseAuthOptions, so the schema generator sees the tables.
 */

export const APP_NAME = "Esionage";

/** How a session was signed in, kept on the session row (`session.auth_method`). */
export type AuthMethod = "password" | "social" | "passkey" | "totp" | "recovery-code";

const AUTH_METHOD_BY_PATH: Record<string, AuthMethod> = {
  "/sign-in/email": "password",
  "/sign-up/email": "password",
  "/sign-in/social": "social",
  "/callback/:id": "social",
  "/passkey/verify-authentication": "passkey",
  "/two-factor/verify-totp": "totp",
  "/two-factor/verify-backup-code": "recovery-code",
};

/** The sign-in method behind a new session, from the endpoint that creates it. */
export function authMethodOf(path: string | undefined): AuthMethod | null {
  return (path && Object.hasOwn(AUTH_METHOD_BY_PATH, path) && AUTH_METHOD_BY_PATH[path]) || null;
}

/**
 * `databaseHooks.session.create.before`: records how the session was signed in. A session
 * recreated from another (turning two-step verification on or off swaps it) keeps the original.
 */
export async function recordAuthMethod<S extends Record<string, unknown>>(session: S, ctx: { path?: string } | null | undefined) {
  const existing = (session as { authMethod?: string | null }).authMethod;
  return { data: { ...session, authMethod: existing ?? authMethodOf(ctx?.path) } };
}

/**
 * Whether a session passes a workspace's "require two-step verification" policy. With two-step
 * verification on, every way of signing in asks for a code (password, and social sign-in via
 * `socialTwoFactorChallenge`), so all of that user's sessions count. A passkey is two factors
 * in one (the device and its unlock), so a session signed in with one counts too; a passkey
 * registered on an account that signs in with a password alone does not.
 */
export function isStrongSession(session: {
  user: { twoFactorEnabled?: boolean | null };
  session: { authMethod?: string | null };
}) {
  return session.user.twoFactorEnabled === true || session.session.authMethod === "passkey";
}

/** Relying party for passkeys: the public origin, so a passkey only ever works on this server. */
export function passkeyRelyingParty(appUrl: string) {
  const url = new URL(appUrl);
  return { rpID: url.hostname, rpName: APP_NAME, origin: url.origin };
}

/**
 * Same-origin path of a redirect target (absolute or relative), or null. Social sign-in comes back
 * through the provider callback with its destination in `location`; the code step carries it on.
 */
export function sameOriginPath(target: string | null | undefined, appUrl: string) {
  if (!target) return null;
  try {
    const base = new URL(appUrl);
    const url = new URL(target, base);
    if (url.origin !== base.origin) return null;
    const path = url.pathname + url.search;
    return path.startsWith("/") && !path.startsWith("//") ? path : null;
  } catch {
    return null;
  }
}

/**
 * Where a social sign-in that still needs a code continues: the sign-in page's code step. With
 * `oauthQuery` (the signed query of an app's authorization request, see socialTwoFactorRedirect)
 * the page carries it on, so entering the code resumes the authorization like any sign-in there.
 */
export function twoFactorStepUrl(next: string | null, oauthQuery?: string | null) {
  const params = new URLSearchParams(oauthQuery ?? undefined);
  params.delete("step");
  params.delete("next");
  params.set("step", "two-factor");
  if (next && next !== "/") params.set("next", next);
  return `/sign-in?${params}`;
}

/** Key of the signed authorization query in the social sign-in's OAuth state (server-trusted). */
const OAUTH_QUERY_KEY = "esionageOAuthQuery";

type AfterHook = NonNullable<NonNullable<BetterAuthPlugin["hooks"]>["after"]>[number];

/**
 * Better Auth's two-factor plugin, with its sign-in challenge extended from password sign-in to
 * social sign-in (the provider callback, and `/sign-in/social` with an ID token). Without that,
 * "Continue with Google" would skip the code. The challenge itself (trusted devices, the pending
 * sign-in cookie, attempt counting) stays the plugin's own.
 */
export function twoFactorPlugin() {
  const plugin = twoFactor({
    issuer: APP_NAME,
    // Accounts that only sign in with GitHub or Google have no password to confirm with; for them
    // turning it off asks for a code instead (see requireCodeToDisable).
    allowPasswordless: true,
    backupCodeOptions: { amount: 10, length: 10 },
  });
  const challenge = plugin.hooks.after[0] as AfterHook;
  return {
    ...plugin,
    hooks: {
      ...plugin.hooks,
      after: [
        {
          matcher: (ctx) => challenge.matcher(ctx) || ctx.path === "/callback/:id" || ctx.path === "/sign-in/social",
          handler: challenge.handler,
        },
      ],
    },
  } as typeof plugin;
}

/**
 * Runs after the two-factor plugin: a provider callback it held back answers JSON meant for
 * fetch calls, which would leave the browser on a page of JSON. Send it to the code step instead,
 * keeping where the sign-in was headed.
 *
 * Signing in to authorize an app (MCP) puts the app's signed authorization query on the sign-in
 * page; the OAuth provider resumes from it once a session cookie is set. The code step comes
 * after the provider round trip, so the query rides along in the social sign-in's state (checked
 * by the OAuth provider's own before-hook on the same request) and comes back on the code step's
 * address, where the client sends it with the code.
 */
export function socialTwoFactorRedirect(appUrl: string) {
  return {
    id: "esionage-social-two-factor",
    hooks: {
      before: [
        {
          matcher: (ctx) => ctx.path === "/sign-in/social" && typeof ctx.body?.oauth_query === "string",
          handler: createAuthMiddleware(async (ctx) => {
            await addOAuthServerContext({ [OAUTH_QUERY_KEY]: (ctx.body as { oauth_query: string }).oauth_query });
          }),
        },
      ],
      after: [
        {
          matcher: (ctx) => ctx.path === "/callback/:id",
          handler: createAuthMiddleware(async (ctx) => {
            const returned = ctx.context.returned as { twoFactorRedirect?: boolean } | undefined;
            if (!returned || typeof returned !== "object" || returned.twoFactorRedirect !== true) return;
            const next = sameOriginPath(ctx.context.responseHeaders?.get("location"), appUrl);
            const oauthQuery = (await getOAuthState())?.serverContext?.[OAUTH_QUERY_KEY];
            throw ctx.redirect(twoFactorStepUrl(next, typeof oauthQuery === "string" ? oauthQuery : null));
          }),
        },
      ],
    },
  } satisfies BetterAuthPlugin;
}

export function passkeyPlugin(appUrl: string) {
  return passkey({
    ...passkeyRelyingParty(appUrl),
    authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
  });
}

/**
 * `hooks.before` for `/two-factor/disable`. Better Auth asks for the password there, but with
 * `allowPasswordless` an account without one would need nothing but its session. Such accounts
 * confirm with a current authenticator code or an unused recovery code instead.
 */
export async function requireCodeToDisable(ctx: Parameters<Parameters<typeof createAuthMiddleware>[0]>[0]) {
  const session = await getSessionFromCtx(ctx);
  if (!session) return; // the endpoint answers 401
  const credential = await ctx.context.internalAdapter.findCredentialAccount(session.user.id);
  if (credential?.password) return; // the endpoint checks the password
  const code = (ctx.body as { code?: unknown } | undefined)?.code;
  if (typeof code !== "string" || !code.trim()) {
    throw APIError.from("BAD_REQUEST", { message: "Enter a code to confirm", code: "TWO_FACTOR_CODE_REQUIRED" });
  }
  const row = await ctx.context.adapter.findOne<{ secret: string; backupCodes: string }>({
    model: "twoFactor",
    where: [{ field: "userId", value: session.user.id }],
  });
  if (!row) return; // nothing to turn off; the endpoint just clears the flag
  if (await codeMatches(code, row, ctx.context.secretConfig)) return;
  throw APIError.from("UNAUTHORIZED", { message: "Invalid code", code: "INVALID_CODE" });
}

type SecretKey = Parameters<typeof symmetricDecrypt>[0]["key"];

/**
 * Whether `code` is the current code of the user's authenticator app or one of their unused
 * recovery codes. Both are stored encrypted with the auth secret, the way Better Auth writes them.
 */
export async function codeMatches(code: string, row: { secret: string; backupCodes: string }, key: SecretKey) {
  const clean = code.trim();
  const secret = await symmetricDecrypt({ key, data: row.secret });
  if (verifyTotp(Buffer.from(secret, "utf8"), clean.replace(/\s+/g, ""))) return true;
  // A JSON array of strings (the plugin's getBackupCodes isn't exported at runtime).
  try {
    const codes: unknown = JSON.parse(await symmetricDecrypt({ key, data: row.backupCodes }));
    return Array.isArray(codes) && codes.includes(clean);
  } catch {
    return false;
  }
}

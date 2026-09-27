import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { db, schema } from "@/db";
import { isSsoSignInPath, recordAuthMethod } from "@/lib/auth-security";
import { workspaceOfProvider } from "@/lib/sso-config";
import { requestLocale } from "@/i18n/config";
import { env } from "@/lib/env";
import {
  baseAuthOptions,
  claimOnEmailLink,
  closedSignUpGuard,
  signUpTokenOf,
  socialAuthOptions,
} from "@/lib/auth-options";
import { revokeAllApiTokens } from "@/server/api/tokens";
import { revokeAllConnectedApps } from "@/server/mcp/grants";
import { mailStatus, PASSWORD_RESET_MINUTES, passwordResetEmail, sendMail } from "@/server/mail";
import { joinThroughSso, resolveSsoProvider, ssoAccountCreation } from "@/server/sso";
import { acceptInvitation, createPersonalWorkspace, invitationAllowsSignUp, joinWithLink } from "@/server/workspaces";

export { MCP_SCOPES } from "@/lib/auth-options";

const base = baseAuthOptions({
  invitationAllowsSignUp,
  instanceOidc: env.instanceOidc,
  sso: {
    resolveProvider: resolveSsoProvider,
    // Every SSO sign-in (the plugin calls it on each one): join the connection's workspace.
    provisionUser: async ({ user, provider }) => {
      await joinThroughSso(provider.providerId, user);
    },
  },
});

type HookContext = { path?: string; params?: unknown } | null | undefined;

/** The provider of a single sign-on that is creating or signing in a user, or null. */
function ssoProviderOf(ctx: HookContext) {
  if (!isSsoSignInPath(ctx?.path)) return null;
  const id = (ctx?.params as { providerId?: unknown } | undefined)?.providerId;
  return typeof id === "string" ? id : null;
}

const signUpGuard = closedSignUpGuard(invitationAllowsSignUp);

/**
 * `databaseHooks.user.create.before`. A single sign-on creates accounts by its own rules (see
 * ssoAccountCreation: the instance provider always, a workspace connection for its verified
 * domains only, closed sign-up or not) and marks the address verified when the provider vouches for
 * it. Everything else goes through closed sign-up.
 */
async function beforeUserCreate(user: { email: string } & Record<string, unknown>, ctx: HookContext) {
  const providerId = ssoProviderOf(ctx);
  if (providerId !== null) {
    const decision = await ssoAccountCreation(providerId, user.email);
    if (!decision.allowed) {
      throw APIError.from("FORBIDDEN", {
        message: "This single sign-on can't create an account for that email address",
        code: "sso_sign_up_not_allowed",
      });
    }
    return { data: { ...user, emailVerified: user.emailVerified === true || decision.emailVerified } };
  }
  await signUpGuard(user, ctx as Parameters<typeof signUpGuard>[1]);
}

/**
 * Emails a reset link. Not awaited, so the endpoint answers equally fast whether or not an
 * account exists for the address; failures only reach the log.
 */
async function sendResetPassword({ user, url }: { user: { email: string; name: string }; url: string }, request?: Request) {
  const locale = request ? requestLocale(request.headers) : "en";
  void sendMail({ to: user.email, ...passwordResetEmail(locale, { name: user.name, url }) }).catch((error) =>
    console.error("could not send password reset email", error),
  );
}

export const auth = betterAuth({
  ...base,
  secret: env.authSecret,
  database: drizzleAdapter(db, { provider: "pg", schema }),
  emailAndPassword: {
    ...base.emailAndPassword,
    // Without email the endpoint answers RESET_PASSWORD_DISABLED and the page explains why.
    sendResetPassword: mailStatus() === "disabled" ? undefined : sendResetPassword,
    resetPasswordTokenExpiresIn: PASSWORD_RESET_MINUTES * 60,
    revokeSessionsOnPasswordReset: true,
  },
  rateLimit: {
    customRules: {
      "/request-password-reset": { window: 60, max: 3 },
      "/reset-password": { window: 60, max: 10 },
    },
  },
  ...socialAuthOptions(env.socialProviders),
  // Identity providers on a private network that SSO may call (the instance issuer, SSO_TRUSTED_ORIGINS).
  trustedOrigins: env.ssoTrustedOrigins,
  databaseHooks: {
    user: {
      create: {
        before: beforeUserCreate,
        after: async (user, ctx) => {
          // A workspace connection's sign-in joins that workspace instead (provisionUser above).
          if (workspaceOfProvider(ssoProviderOf(ctx))) return;
          // Signing up from an invitation link joins that workspace instead of creating a
          // personal one; if the invitation was revoked meanwhile, fall back to a personal one.
          const token = await signUpTokenOf(ctx, "invite");
          if (token) {
            try {
              await acceptInvitation(token, user.id, user.email);
              return;
            } catch (error) {
              console.error("could not accept invitation on sign-up", error);
            }
          }
          // Same for a workspace's join link (it never opens closed sign-up, see baseAuthOptions).
          const joinToken = await signUpTokenOf(ctx, "join");
          if (joinToken) {
            try {
              await joinWithLink(joinToken, user.id, user.email);
              return;
            } catch (error) {
              console.error("could not join with link on sign-up", error);
            }
          }
          await createPersonalWorkspace(user.id, user.name);
        },
      },
    },
    account: {
      // Claiming an account by email also ends what was granted before: app grants and API tokens.
      create: {
        after: claimOnEmailLink(async (userId) => {
          await revokeAllConnectedApps(userId);
          await revokeAllApiTokens(userId);
        }),
      },
    },
    session: {
      // How the session was signed in: a passkey sign-in passes "require two-step verification".
      create: { before: recordAuthMethod },
    },
  },
  plugins: [...base.plugins, nextCookies()],
});

export type Session = typeof auth.$Infer.Session;

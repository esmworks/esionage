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
import { applyDomainPolicies } from "@/server/join-requests";
import { mailStatus, PASSWORD_RESET_MINUTES, passwordResetEmail, sendMail, verificationEmail } from "@/server/mail";
import {
  afterPasswordReset,
  clearPasswordResetRequirement,
  holdRequiredPasswordReset,
  requiredPasswordPlugin,
} from "@/server/required-password";
import { joinThroughSso, resolveSsoProvider, ssoAccountCreation } from "@/server/sso";
import { acceptInvitation, createPersonalWorkspace, invitationAllowsSignUp, joinWithLink } from "@/server/workspaces";

export { MCP_SCOPES } from "@/lib/auth-options";

const base = baseAuthOptions({
  invitationAllowsSignUp,
  instanceOidc: env.instanceOidc,
  sso: { resolveProvider: resolveSsoProvider },
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

/**
 * Allowed email domains (server/join-requests.ts) after a sign-up, sign-in or verification. Never
 * throws: signing in must not fail because a workspace couldn't take the person in.
 */
async function domainPolicies(userId: string) {
  try {
    return await applyDomainPolicies(userId);
  } catch (error) {
    console.error("could not apply allowed email domains", error);
    return [];
  }
}

/**
 * Emails the link that verifies an address. Email and password sign-up gets one right away; the
 * account page sends another on request. Not awaited, like password resets.
 */
async function sendVerificationEmail({ user, url }: { user: { email: string; name: string }; url: string }, request?: Request) {
  const locale = request ? requestLocale(request.headers) : "en";
  void sendMail({ to: user.email, ...verificationEmail(locale, { name: user.name, url }) }).catch((error) =>
    console.error("could not send verification email", error),
  );
}

export const auth = betterAuth({
  ...base,
  secret: env.authSecret,
  database: drizzleAdapter(db, { provider: "pg", schema }),
  // Proving an address is only needed for allowed email domains (a verified address may join a
  // workspace on its own); nobody has to verify to sign in. Without email on this server nothing
  // can be verified this way: only providers that vouch for the address count (see join-requests).
  ...(mailStatus() === "disabled"
    ? {}
    : {
        emailVerification: {
          sendVerificationEmail,
          sendOnSignUp: true,
          autoSignInAfterVerification: true,
          afterEmailVerification: async (user: { id: string }) => {
            await domainPolicies(user.id);
          },
        },
      }),
  emailAndPassword: {
    ...base.emailAndPassword,
    // Without email the endpoint answers RESET_PASSWORD_DISABLED and the page explains why.
    sendResetPassword: mailStatus() === "disabled" ? undefined : sendResetPassword,
    resetPasswordTokenExpiresIn: PASSWORD_RESET_MINUTES * 60,
    revokeSessionsOnPasswordReset: true,
    // A reset through the emailed link proves the address, so it counts as verified, and allowed
    // email domains apply as after any other verification.
    onPasswordReset: async ({ user }) => {
      await afterPasswordReset(user.id);
      await domainPolicies(user.id);
    },
  },
  rateLimit: {
    customRules: {
      "/request-password-reset": { window: 60, max: 3 },
      "/reset-password": { window: 60, max: 10 },
      "/send-verification-email": { window: 60, max: 3 },
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
          // A workspace connection's sign-in joins that workspace instead (account.create.after).
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
          // Same for a workspace's join link (it never opens closed sign-up, see baseAuthOptions),
          // unless the link only asked an owner to let them in.
          const joinToken = await signUpTokenOf(ctx, "join");
          if (joinToken) {
            try {
              if ((await joinWithLink(joinToken, user.id, user.email)).status === "joined") return;
            } catch (error) {
              console.error("could not join with link on sign-up", error);
            }
          }
          // A verified address (Google, GitHub, the instance's SSO) on a workspace's allowed
          // domain joins that workspace; they start there instead of in a personal one.
          if ((await domainPolicies(user.id)).length) return;
          await createPersonalWorkspace(user.id, user.name);
        },
      },
    },
    account: {
      // Claiming an account by email also ends what was granted before: app grants and API tokens.
      create: {
        after: async (account, ctx) => {
          await claimOnEmailLink(async (userId) => {
            await revokeAllConnectedApps(userId);
            await revokeAllApiTokens(userId);
          })(account, ctx);
          // The first sign-in through a workspace's connection (a new account, or an existing one
          // linked by email) joins that workspace. Only the first: someone an owner removed later
          // stays out; their identity provider brings them back over SCIM.
          if (workspaceOfProvider(ssoProviderOf(ctx)) && account.providerId === ssoProviderOf(ctx)) {
            const owner = await ctx?.context.internalAdapter.findUserById(account.userId);
            if (owner) await joinThroughSso(account.providerId, owner);
          }
        },
      },
      // Better Auth updates the credential account only to change its password (/change-password);
      // a new one means an instance admin's "choose a new password" is done.
      update: {
        after: async (account) => {
          if (account?.providerId === "credential") await clearPasswordResetRequirement(account.userId);
        },
      },
    },
    session: {
      create: {
        // How the session was signed in: a passkey sign-in passes "require two-step verification".
        before: async (session, ctx) => {
          // A password sign-in of an account that has to choose a new password gets no session.
          await holdRequiredPasswordReset(session, ctx);
          return recordAuthMethod(session, ctx);
        },
        // Every sign-in: workspaces that allow the (verified) email domain and haven't dealt with
        // this person yet let them in or take their request.
        after: async (session) => {
          await domainPolicies(session.userId);
        },
      },
    },
  },
  plugins: [...base.plugins, requiredPasswordPlugin(), nextCookies()],
});

export type Session = typeof auth.$Infer.Session;

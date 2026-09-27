import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { db, schema } from "@/db";
import { requestLocale } from "@/i18n/config";
import { env } from "@/lib/env";
import { baseAuthOptions, closedSignUpGuard, signUpTokenOf, socialAuthOptions } from "@/lib/auth-options";
import { mailStatus, PASSWORD_RESET_MINUTES, passwordResetEmail, sendMail } from "@/server/mail";
import { acceptInvitation, createPersonalWorkspace, invitationAllowsSignUp, joinWithLink } from "@/server/workspaces";

export { MCP_SCOPES } from "@/lib/auth-options";

const base = baseAuthOptions({ invitationAllowsSignUp });

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
  databaseHooks: {
    user: {
      create: {
        before: closedSignUpGuard(invitationAllowsSignUp),
        after: async (user, ctx) => {
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
  },
  plugins: [...base.plugins, nextCookies()],
});

export type Session = typeof auth.$Infer.Session;

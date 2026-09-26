import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { db, schema } from "@/db";
import { env } from "@/lib/env";
import { baseAuthOptions, inviteTokenOf } from "@/lib/auth-options";
import { acceptInvitation, createPersonalWorkspace, invitationAllowsSignUp } from "@/server/workspaces";

export { MCP_SCOPES } from "@/lib/auth-options";

const base = baseAuthOptions({ invitationAllowsSignUp });

export const auth = betterAuth({
  ...base,
  secret: env.authSecret,
  database: drizzleAdapter(db, { provider: "pg", schema }),
  databaseHooks: {
    user: {
      create: {
        after: async (user, ctx) => {
          // Signing up from an invitation link joins that workspace instead of creating a
          // personal one; if the invitation was revoked meanwhile, fall back to a personal one.
          const token = inviteTokenOf(ctx);
          if (token) {
            try {
              await acceptInvitation(token, user.id, user.email);
              return;
            } catch (error) {
              console.error("could not accept invitation on sign-up", error);
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

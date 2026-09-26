import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { db, schema } from "@/db";
import { env } from "@/lib/env";
import { baseAuthOptions } from "@/lib/auth-options";
import { createPersonalWorkspace } from "@/server/workspaces";

export { MCP_SCOPES } from "@/lib/auth-options";

const base = baseAuthOptions();

export const auth = betterAuth({
  ...base,
  secret: env.authSecret,
  database: drizzleAdapter(db, { provider: "pg", schema }),
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          await createPersonalWorkspace(user.id, user.name);
        },
      },
    },
  },
  plugins: [...base.plugins, nextCookies()],
});

export type Session = typeof auth.$Infer.Session;

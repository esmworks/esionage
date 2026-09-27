"use client";
import { createAuthClient } from "better-auth/react";
import { twoFactorClient } from "better-auth/client/plugins";
import { passkeyClient } from "@better-auth/passkey/client";
import { oauthProviderClient } from "@better-auth/oauth-provider/client";

export const authClient = createAuthClient({
  // The sign-in form handles `twoFactorRedirect` itself (it shows the code step in place).
  plugins: [twoFactorClient(), passkeyClient(), oauthProviderClient()],
});

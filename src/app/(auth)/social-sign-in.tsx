"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui";
import { authClient } from "@/lib/auth-client";
import { SOCIAL_PROVIDER_NAMES, type SocialProvider } from "@/lib/social-providers";

const NAMES = SOCIAL_PROVIDER_NAMES;

function GitHubMark() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" width="16" height="16" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

const MARKS: Record<SocialProvider, () => React.ReactNode> = { github: GitHubMark, google: GoogleMark };

/** OAuth error codes (`?error=` on return from the provider) we have our own wording for. */
const SOCIAL_ERROR_KEYS = {
  signup_disabled: "socialSignUpDisabled",
  account_not_linked: "socialNotLinked",
  email_not_found: "socialNoEmail",
  access_denied: "socialCancelled",
} as const;

export function socialErrorKey(code: string) {
  return Object.hasOwn(SOCIAL_ERROR_KEYS, code) ? SOCIAL_ERROR_KEYS[code as keyof typeof SOCIAL_ERROR_KEYS] : "socialFailed";
}

/**
 * "Continue with …" buttons for the providers the server has configured (the form draws the "or"
 * divider above them). An invitation or join
 * link token goes along as a query parameter; the server carries it through the provider redirect.
 */
export function SocialSignIn({
  providers,
  callbackURL,
  newUserCallbackURL,
  query,
  onError,
}: {
  providers: SocialProvider[];
  /** Same-origin path to open afterwards. */
  callbackURL: string;
  /** Where a newly created account goes instead, when that differs. */
  newUserCallbackURL?: string;
  query?: Record<string, string>;
  onError: (message: string) => void;
}) {
  const t = useTranslations("auth");
  const tc = useTranslations("common");
  const [pending, setPending] = useState<SocialProvider | null>(null);

  async function start(provider: SocialProvider) {
    setPending(provider);
    // Failures come back to this page as `?error=`; drop an earlier one first.
    const here = new URL(window.location.href);
    here.searchParams.delete("error");
    here.searchParams.delete("error_description");
    const result = await authClient.signIn.social({
      provider,
      callbackURL,
      newUserCallbackURL,
      errorCallbackURL: here.pathname + here.search,
      fetchOptions: query ? { query } : undefined,
    });
    // On success the browser is already on its way to the provider.
    if (result.error) {
      setPending(null);
      onError(result.error.status === 429 ? t("errors.tooManyAttempts") : tc("genericError"));
    }
  }

  return (
    <>
      {providers.map((provider) => {
          const Mark = MARKS[provider];
          return (
            <Button key={provider} className="w-full gap-2" disabled={pending !== null} onClick={() => start(provider)}>
              <Mark />
              {pending === provider ? t("pending") : t("social.continueWith", { provider: NAMES[provider] })}
            </Button>
          );
        })}
    </>
  );
}

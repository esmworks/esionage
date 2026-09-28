import { eq, sql } from "drizzle-orm";
import { getLocale } from "next-intl/server";
import { db } from "@/db";
import { userPreference } from "@/db/schema";
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE, requestLocale as headersLocale, type Locale } from "@/i18n/config";

/**
 * The language of emails. An email to someone with an account is written in the language they last
 * used Leafdesk in (`user_preference.locale`, kept by `rememberLocale`), since the interface
 * language itself lives in a cookie of each browser and the server never sees the recipient's.
 * Until it is known (they haven't signed in since it is stored), or for an address without an
 * account (an invitation), the email falls back to the language it was queued with: the actor's,
 * or the one the requester asked in.
 */

/**
 * The interface language of whoever made the current request, or the default outside a request.
 * Emails queued by their action keep it as the fallback for recipients whose language isn't known.
 */
export async function requestLocale(): Promise<Locale> {
  try {
    const locale = await getLocale();
    return isLocale(locale) ? locale : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

/**
 * The language a request shows the app in (its saved choice, else Accept-Language), or null when
 * it says nothing about it: a script or server-to-server call without either header, or with
 * `Accept-Language: *` (Node's fetch), shouldn't overwrite someone's language with the default.
 */
export function statedLocale(headers: Headers | null | undefined): Locale | null {
  if (!headers) return null;
  const chosen = headers.get("cookie")?.includes(`${LOCALE_COOKIE}=`);
  const accepted = headers.get("accept-language")?.trim();
  return chosen || (accepted && accepted !== "*") ? headersLocale(headers) : null;
}

/** The first supported language among `candidates` (null and unknown codes skipped), else the default. */
export function pickLocale(...candidates: unknown[]): Locale {
  return candidates.find(isLocale) ?? DEFAULT_LOCALE;
}

/** The language `userId` last used the app in, or null when it isn't known yet. */
export async function savedLocale(userId: string): Promise<Locale | null> {
  const [row] = await db.select({ locale: userPreference.locale }).from(userPreference).where(eq(userPreference.userId, userId));
  return isLocale(row?.locale) ? row.locale : null;
}

/**
 * The language of an email to `userId`: theirs, else `fallback` (the language the email was queued
 * with), else the default. Never throws: an email in the wrong language beats no email.
 */
export async function recipientLocale(userId: string | null | undefined, fallback: unknown): Promise<Locale> {
  let saved: Locale | null = null;
  if (userId) {
    try {
      saved = await savedLocale(userId);
    } catch (error) {
      console.error("could not read the recipient's language", error);
    }
  }
  return pickLocale(saved, fallback);
}

/**
 * Stores the language `userId` uses now, for the emails they get. Called when they sign in or up
 * and when they change it in the language picker, not on every request; writes nothing when it is
 * the one already stored. Never throws: signing in or switching languages must not fail over it.
 */
export async function rememberLocale(userId: string, locale: unknown) {
  if (!isLocale(locale)) return;
  try {
    await db
      .insert(userPreference)
      .values({ userId, locale })
      .onConflictDoUpdate({
        target: userPreference.userId,
        set: { locale, updatedAt: new Date() },
        setWhere: sql`${userPreference.locale} is distinct from ${locale}`,
      });
  } catch (error) {
    console.error("could not store the user's language", error);
  }
}

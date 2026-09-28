"use server";

import { cookies, headers } from "next/headers";
import { isLocale, LOCALE_COOKIE, negotiateLocale } from "@/i18n/config";
import { rememberLocale } from "@/server/mail/locale";
import { getSession } from "@/server/session";

/**
 * Saves the interface language for this browser; `null` goes back to following the browser. For
 * someone signed in, emails to them follow the change too (see server/mail/locale.ts): the language
 * picked, or the browser's.
 */
export async function setLocaleAction(locale: string | null) {
  if (locale !== null && !isLocale(locale)) throw new Error("Unsupported language");
  const [store, session] = await Promise.all([cookies(), getSession()]);
  if (locale === null) {
    store.delete(LOCALE_COOKIE);
  } else {
    store.set(LOCALE_COOKIE, locale, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  }
  if (session) await rememberLocale(session.user.id, locale ?? negotiateLocale((await headers()).get("accept-language")));
}

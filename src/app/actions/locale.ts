"use server";

import { cookies } from "next/headers";
import { isLocale, LOCALE_COOKIE } from "@/i18n/config";

/** Saves the interface language for this browser; `null` goes back to following the browser. */
export async function setLocaleAction(locale: string | null) {
  const store = await cookies();
  if (locale === null) {
    store.delete(LOCALE_COOKIE);
    return;
  }
  if (!isLocale(locale)) throw new Error("Unsupported language");
  store.set(LOCALE_COOKIE, locale, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
}

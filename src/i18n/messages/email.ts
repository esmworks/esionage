import { LOCALES, type Locale } from "../config";
import en from "./en/email.json";
import { loadLocaleFile, withFallback } from "./index";

/**
 * Email texts (`messages/<locale>/email.json`). Kept out of the app messages so they are not sent
 * to the browser; emails are rendered on the server only. All languages are loaded up front since
 * emails are rendered synchronously.
 */
export const emailMessages: Record<Locale, typeof en> = Object.fromEntries(
  await Promise.all(LOCALES.map(async (locale) => [locale, withFallback(en, await loadLocaleFile(locale, "email"))])),
);

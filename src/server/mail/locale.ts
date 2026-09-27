import { getLocale } from "next-intl/server";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/i18n/config";

/**
 * The interface language of whoever made the current request. Emails about their changes use it,
 * since the recipient's language isn't stored anywhere.
 */
export async function requestLocale(): Promise<Locale> {
  try {
    const locale = await getLocale();
    return isLocale(locale) ? locale : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

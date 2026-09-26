import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { isLocale, LOCALE_COOKIE, negotiateLocale, TIME_ZONE_COOKIE } from "./config";
import { loadMessages } from "./messages";

function isTimeZone(value: string | undefined): value is string {
  if (!value) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export default getRequestConfig(async () => {
  const [store, requestHeaders] = await Promise.all([cookies(), headers()]);
  const saved = store.get(LOCALE_COOKIE)?.value;
  const locale = isLocale(saved) ? saved : negotiateLocale(requestHeaders.get("accept-language"));
  const timeZone = store.get(TIME_ZONE_COOKIE)?.value;
  return {
    locale,
    messages: await loadMessages(locale),
    timeZone: isTimeZone(timeZone) ? timeZone : "UTC",
  };
});

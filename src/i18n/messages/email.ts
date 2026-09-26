import type { Locale } from "../config";
import en from "./en/email.json";
import tr from "./tr/email.json";

/**
 * Email texts. Kept out of the app messages so they are not sent to the browser; emails are
 * rendered on the server only.
 */
export const emailMessages: Record<Locale, typeof en> = { en, tr };

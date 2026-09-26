import type { Locale } from "../config";
import type en from "./en";

export type Messages = typeof en;

export async function loadMessages(locale: Locale): Promise<Messages> {
  return locale === "tr" ? (await import("./tr")).default : (await import("./en")).default;
}

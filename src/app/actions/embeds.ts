"use server";

import { getTranslations } from "next-intl/server";
import { isDatabaseErrorCode } from "@/lib/properties";
import { AccessError } from "@/server/access";
import * as embeds from "@/server/embeds";
import { requireUserId } from "@/server/session";
import { databaseSeedNames } from "./seed-names";

export type EmbedActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

/** The database behind a new inline database block, created under the page being edited. */
export async function createInlineDatabaseAction(hostPageId: string): Promise<EmbedActionResult<{ id: string }>> {
  const userId = await requireUserId();
  try {
    const created = await embeds.createInlineDatabase({ userId }, hostPageId, await databaseSeedNames());
    return { ok: true, data: { id: created.id } };
  } catch (error) {
    const t = await getTranslations();
    const code = (error as { code?: unknown }).code;
    if (isDatabaseErrorCode(code)) return { ok: false, error: t(`database.errors.${code}`) };
    if (error instanceof AccessError) return { ok: false, error: t("database.errors.accessDenied") };
    console.error("[embed action]", error);
    return { ok: false, error: t("common.genericError") };
  }
}

/** What a database block may show; the same answer for missing and hidden databases. */
export async function embedInfoAction(databaseId: string): Promise<embeds.EmbedInfo> {
  const userId = await requireUserId();
  return embeds.getEmbedInfo(userId, databaseId);
}

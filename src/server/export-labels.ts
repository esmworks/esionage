import { getTranslations } from "next-intl/server";
import type { ExportLabels } from "@/server/export";

/** Labels exported Markdown uses, in the reader's language (route handlers only). */
export async function exportLabels(): Promise<ExportLabels> {
  const [tm, te, tc] = await Promise.all([getTranslations("page.mention"), getTranslations("page.embed"), getTranslations("common")]);
  return { untitled: tc("untitled"), noAccess: tm("noAccess"), deleted: tm("deleted"), unavailable: te("unavailable") };
}

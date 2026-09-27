import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { cache } from "react";
import { pageLabel } from "@/lib/labels";
import { getPublishedPage } from "@/server/publication";

/** The published page for a request, shared by metadata and the page; 404 when it isn't public. */
export const loadPublished = cache(async (token: string, pageId?: string) => {
  const data = await getPublishedPage(token, pageId);
  if (!data) notFound();
  return data;
});

export async function publishedMetadata(token: string, pageId?: string): Promise<Metadata> {
  const [data, tc] = await Promise.all([loadPublished(token, pageId), getTranslations("common")]);
  const title = pageLabel(data.title, tc("untitled"));
  return { title: data.icon ? `${data.icon} ${title}` : title };
}

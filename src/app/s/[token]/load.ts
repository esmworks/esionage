import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { cache } from "react";
import { pageLabel } from "@/lib/labels";
import { getPublishedPage } from "@/server/publication";

/** The published page for a request, shared by metadata and the page; 404 when it isn't public. */
export const loadPublished = cache(async (token: string, pageId?: string, viewId?: string) => {
  const data = await getPublishedPage(token, pageId, viewId);
  if (!data) notFound();
  return data;
});

/** `?view=<id>`: which of a published database's views to show. */
export const viewParam = (value: string | string[] | undefined) => (typeof value === "string" && value.length <= 64 ? value : undefined);

export async function publishedMetadata(token: string, pageId?: string, viewId?: string): Promise<Metadata> {
  const [data, tc] = await Promise.all([loadPublished(token, pageId, viewId), getTranslations("common")]);
  const title = pageLabel(data.title, tc("untitled"));
  return {
    title: data.icon ? `${data.icon} ${title}` : title,
    // The layout keeps published pages out of search engines unless the publisher allowed them.
    ...(data.indexable ? { robots: { index: true, follow: true } } : {}),
  };
}

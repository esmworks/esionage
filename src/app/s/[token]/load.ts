import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { cache } from "react";
import { pageLabel } from "@/lib/labels";
import { isSiteKey, pageIdFromSegment, publishedHref } from "@/lib/site";
import { getPublishedPage, type PublishedPage } from "@/server/publication";
import { getSitePage, loadSite, type PublicSite } from "@/server/site";

/**
 * `/s/<key>/…` serves two kinds of addresses: a publication's link (`key` is its token, pages by
 * id) and a workspace's site (`key` is its slug, pages by `<title>-<id>`); see lib/site.ts.
 */
export type LoadedPage = { key: string; data: PublishedPage; site: PublicSite | null };

/** The published page for a request, shared by metadata and the page; 404 when it isn't public. */
export const loadPublished = cache(async (key: string, segment?: string, viewId?: string): Promise<LoadedPage> => {
  if (isSiteKey(key)) {
    const site = await loadSite(key);
    if (!site) notFound();
    const pageId = segment === undefined ? undefined : pageIdFromSegment(segment);
    if (segment !== undefined && !pageId) notFound();
    const found = await getSitePage(site, pageId ?? undefined, viewId);
    if (!found) notFound();
    return { key, ...found };
  }
  const data = await getPublishedPage(key, segment, viewId);
  if (!data) notFound();
  return { key, data, site: null };
});

/** `?view=<id>`: which of a published database's views to show. */
export const viewParam = (value: string | string[] | undefined) => (typeof value === "string" && value.length <= 64 ? value : undefined);

/** Site pages live at one address: others (an old title, the home page by id) lead there. */
export function redirectToCanonical({ data, site }: LoadedPage, segment: string | undefined, viewId: string | undefined) {
  if (!site) return;
  const canonical = publishedHref(data.links, data.id, data.title);
  const current = segment === undefined ? data.links.base : `${data.links.base}/${segment}`;
  if (canonical !== current) redirect(viewId ? `${canonical}?view=${encodeURIComponent(viewId)}` : canonical);
}

export async function publishedMetadata(key: string, segment?: string, viewId?: string): Promise<Metadata> {
  const [{ data, site }, tc] = await Promise.all([loadPublished(key, segment, viewId), getTranslations("common")]);
  const title = pageLabel(data.title, tc("untitled"));
  const full = data.icon ? `${data.icon} ${title}` : title;
  return {
    title: site?.title && data.id !== site.homeId ? `${full} · ${site.title}` : full,
    // The layout keeps published pages out of search engines unless the publisher allowed them.
    ...(data.indexable ? { robots: { index: true, follow: true } } : {}),
    ...(site ? { alternates: { canonical: publishedHref(data.links, data.id, data.title) } } : {}),
  };
}

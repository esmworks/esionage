import type { Metadata } from "next";
import { PublishedView } from "@/components/published/published-view";
import { loadPublished, publishedMetadata, redirectToCanonical, viewParam } from "../load";

type Params = { params: Promise<{ token: string; pageId: string }>; searchParams: Promise<{ view?: string | string[] }> };

export async function generateMetadata({ params, searchParams }: Params): Promise<Metadata> {
  const [{ token, pageId }, { view }] = await Promise.all([params, searchParams]);
  return publishedMetadata(token, pageId, viewParam(view));
}

/** A subpage of a publication (by id), or a page of a site (`<title>-<id>`). */
export default async function PublishedSubpageRoute({ params, searchParams }: Params) {
  const [{ token, pageId }, { view }] = await Promise.all([params, searchParams]);
  const loaded = await loadPublished(token, pageId, viewParam(view));
  redirectToCanonical(loaded, pageId, viewParam(view));
  return <PublishedView loaded={loaded} />;
}

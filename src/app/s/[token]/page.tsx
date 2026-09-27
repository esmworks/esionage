import type { Metadata } from "next";
import { PublishedView } from "@/components/published/published-view";
import { loadPublished, publishedMetadata, redirectToCanonical, viewParam } from "./load";

type Params = { params: Promise<{ token: string }>; searchParams: Promise<{ view?: string | string[] }> };

export async function generateMetadata({ params, searchParams }: Params): Promise<Metadata> {
  const [{ token }, { view }] = await Promise.all([params, searchParams]);
  return publishedMetadata(token, undefined, viewParam(view));
}

/** A publication's page (`token`), or a site's home page (a slug). */
export default async function PublishedRootRoute({ params, searchParams }: Params) {
  const [{ token }, { view }] = await Promise.all([params, searchParams]);
  const loaded = await loadPublished(token, undefined, viewParam(view));
  redirectToCanonical(loaded, undefined, viewParam(view));
  return <PublishedView loaded={loaded} />;
}

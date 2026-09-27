import type { Metadata } from "next";
import { PublishedView } from "@/components/published/published-view";
import { loadPublished, publishedMetadata, viewParam } from "../load";

type Params = { params: Promise<{ token: string; pageId: string }>; searchParams: Promise<{ view?: string | string[] }> };

export async function generateMetadata({ params, searchParams }: Params): Promise<Metadata> {
  const [{ token, pageId }, { view }] = await Promise.all([params, searchParams]);
  return publishedMetadata(token, pageId, viewParam(view));
}

export default async function PublishedSubpageRoute({ params, searchParams }: Params) {
  const [{ token, pageId }, { view }] = await Promise.all([params, searchParams]);
  return <PublishedView data={await loadPublished(token, pageId, viewParam(view))} />;
}

import type { Metadata } from "next";
import { PublishedView } from "@/components/published/published-view";
import { loadPublished, publishedMetadata } from "../load";

type Params = { params: Promise<{ token: string; pageId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { token, pageId } = await params;
  return publishedMetadata(token, pageId);
}

export default async function PublishedSubpageRoute({ params }: Params) {
  const { token, pageId } = await params;
  return <PublishedView data={await loadPublished(token, pageId)} />;
}

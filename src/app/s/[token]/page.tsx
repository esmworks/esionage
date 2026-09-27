import type { Metadata } from "next";
import { PublishedView } from "@/components/published/published-view";
import { loadPublished, publishedMetadata } from "./load";

type Params = { params: Promise<{ token: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { token } = await params;
  return publishedMetadata(token);
}

export default async function PublishedRootRoute({ params }: Params) {
  const { token } = await params;
  return <PublishedView data={await loadPublished(token)} />;
}

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { cache } from "react";
import { PrintView } from "@/components/print/print-view";
import { pageLabel } from "@/lib/labels";
import { AccessError, TwoFactorRequiredError } from "@/server/access";
import { getPage } from "@/server/pages";
import { printDocument } from "@/server/print";
import { blockedByTwoFactorPolicy, requireSession, twoStepPath } from "@/server/session";

/**
 * The print view of a page (`/print/<pageId>`, the page menu's "Export as PDF"), outside the
 * workspace layout so nothing but the page is printed. The same access as opening the page: signed
 * in, able to view it (404 otherwise, whether or not it exists), and past the workspace's two-step
 * policy. `?subpages=1` adds the pages under it; `?auto=1` opens the print dialog once loaded.
 */

type Params = { params: Promise<{ pageId: string }>; searchParams: Promise<{ subpages?: string | string[]; auto?: string | string[] }> };

const load = cache(async (pageId: string, subpages: boolean) => {
  const session = await requireSession();
  try {
    const target = await getPage(session.user.id, pageId);
    // The access checks hold the session to the policy too (TwoFactorRequiredError, below).
    if (await blockedByTwoFactorPolicy(session, target.workspaceId)) redirect(twoStepPath(target.workspaceId));
    return await printDocument(session.user.id, pageId, { subpages });
  } catch (error) {
    if (error instanceof TwoFactorRequiredError) redirect(twoStepPath(error.workspaceId));
    if (error instanceof AccessError) notFound();
    throw error;
  }
});

export async function generateMetadata({ params, searchParams }: Params): Promise<Metadata> {
  const [{ pageId }, query, tc] = await Promise.all([params, searchParams, getTranslations("common")]);
  const doc = await load(pageId, query.subpages === "1");
  // The browser names the saved PDF after the document's title: just the page's.
  return { title: { absolute: pageLabel(doc.sections[0].title, tc("untitled")) }, robots: { index: false, follow: false } };
}

export default async function PrintRoute({ params, searchParams }: Params) {
  const [{ pageId }, query] = await Promise.all([params, searchParams]);
  const subpages = query.subpages === "1";
  const doc = await load(pageId, subpages);
  return <PrintView doc={doc} pageId={pageId} subpages={subpages} auto={query.auto === "1"} />;
}

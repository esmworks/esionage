"use server";

import * as publication from "@/server/publication";
import { requireUserId } from "@/server/session";

/** Site path of a published page; the client prefixes its own origin for copying. */
const publicPath = (token: string) => `/s/${token}`;

/** The page's publication, if any, and why the viewer can't publish it (null when they can). */
export async function getPublicationAction(pageId: string) {
  const userId = await requireUserId();
  const [found, blocker] = await Promise.all([
    publication.getPublication(userId, pageId),
    publication.publishBlocker(userId, pageId),
  ]);
  return {
    publication: found ? { token: found.token, url: publicPath(found.token), createdAt: found.createdAt } : null,
    blocker,
  };
}

export async function publishPageAction(pageId: string) {
  const userId = await requireUserId();
  const { token } = await publication.publishPage(userId, pageId);
  return { token, url: publicPath(token) };
}

export async function unpublishPageAction(pageId: string) {
  const userId = await requireUserId();
  await publication.unpublishPage(userId, pageId);
}

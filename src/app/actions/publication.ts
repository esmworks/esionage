"use server";

import * as publication from "@/server/publication";
import { requireUserId } from "@/server/session";

/** Site path of a published page; the client prefixes its own origin for copying. */
const publicPath = (token: string) => `/s/${token}`;

/**
 * The page's publication, if any, why the viewer can't publish it (null when they can), and for
 * databases the views published pages show.
 */
export async function getPublicationAction(pageId: string) {
  const userId = await requireUserId();
  const [found, blocker, views] = await Promise.all([
    publication.getPublication(userId, pageId),
    publication.publishBlocker(userId, pageId),
    publication.getWebViews(userId, pageId),
  ]);
  return {
    publication: found
      ? { token: found.token, url: publicPath(found.token), indexable: found.indexable, createdAt: found.createdAt }
      : null,
    blocker,
    views,
  };
}

export async function publishPageAction(pageId: string) {
  const userId = await requireUserId();
  const { token, indexable } = await publication.publishPage(userId, pageId);
  return { token, url: publicPath(token), indexable };
}

export async function unpublishPageAction(pageId: string) {
  const userId = await requireUserId();
  await publication.unpublishPage(userId, pageId);
}

export async function setPublicationIndexableAction(pageId: string, indexable: boolean) {
  const userId = await requireUserId();
  await publication.setPublicationIndexable(userId, pageId, indexable);
}

export async function setWebViewsAction(databaseId: string, viewIds: string[]) {
  const userId = await requireUserId();
  await publication.setWebViews(userId, databaseId, viewIds);
  return publication.getWebViews(userId, databaseId);
}

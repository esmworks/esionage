"use server";

import * as publication from "@/server/publication";
import { requireUserId } from "@/server/session";

/** Site path of a published page; the client prefixes its own origin for copying. */
const publicPath = (token: string) => `/s/${token}`;

export async function getPublicationAction(pageId: string) {
  const userId = await requireUserId();
  const found = await publication.getPublication(userId, pageId);
  return found ? { token: found.token, url: publicPath(found.token), createdAt: found.createdAt } : null;
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

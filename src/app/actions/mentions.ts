"use server";

import { AccessError } from "@/server/access";
import * as mentions from "@/server/mentions";
import { requireUserId } from "@/server/session";

/** What the @ menu (and the "Link to page" picker) offers on a page the user may edit. */
export async function mentionCandidatesAction(pageId: string, query: string): Promise<mentions.MentionCandidates> {
  const userId = await requireUserId();
  try {
    return await mentions.mentionCandidates(userId, pageId, query);
  } catch (error) {
    if (error instanceof AccessError) return { people: [], pages: [] };
    throw error;
  }
}

/** Live titles and icons of mentioned pages, as far as the user may see them. */
export async function resolvePagesAction(pageIds: string[]) {
  const userId = await requireUserId();
  return mentions.resolvePageRefs(userId, Array.isArray(pageIds) ? pageIds : []);
}

/** The pages linking to this one that the user can see. */
export async function backlinksAction(pageId: string) {
  const userId = await requireUserId();
  try {
    return await mentions.listBacklinks(userId, pageId);
  } catch (error) {
    if (error instanceof AccessError) return [];
    throw error;
  }
}

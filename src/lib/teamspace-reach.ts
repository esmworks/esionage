import type { TeamspaceAccess } from "@/db/schema/app";
import type { PageLevel } from "@/db/schema/permissions";

const ORDER: readonly PageLevel[] = ["none", "view", "comment", "edit", "full"];

/** A teamspace's access and who is in it by row (a default one has everyone in it anyway). */
export type TeamspaceReach = { access: TeamspaceAccess; members: ReadonlySet<string> };

/**
 * The least an owner or member of the workspace gets from a page's "everyone" level, the way
 * page_access_level works it out: all of it on a private page (`reach` null) or in a teamspace
 * they are in; up to "comment" on a page of an open teamspace they haven't joined; nothing on a
 * closed or private one's. Guests are never reached; callers leave them out.
 */
export function everyoneFloor(everyone: PageLevel, reach: TeamspaceReach | null, userId: string): PageLevel {
  if (!reach || reach.access === "default" || reach.members.has(userId)) return everyone;
  if (reach.access === "open") return ORDER.indexOf(everyone) < ORDER.indexOf("comment") ? everyone : "comment";
  return "none";
}

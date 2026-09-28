import { sql } from "drizzle-orm";
import { db } from "@/db";
import { page } from "@/db/schema";
import type { DirectoryPerson, DirectoryPage } from "@/lib/people";
import { accessRank, isGuest, requireMember } from "@/server/access";
import { editsSince } from "@/server/analytics";
import { groupsByMember } from "@/server/groups";
import { teamspacesByMember } from "@/server/teamspaces";
import { workspacePeople } from "@/server/workspaces";

/** How far back "recently edited" looks: the longest analytics period, as far as history goes. */
const RECENT_DAYS = 90;
/** Recent pages shown on each card. */
const RECENT_PER_PERSON = 3;
/**
 * The latest pages of each person that are checked for the viewer's access. Bounds the access
 * checks per card; a person whose latest pages are all closed to the viewer shows none.
 */
const RECENT_CANDIDATES = 20;

/**
 * Up to RECENT_PER_PERSON pages each person edited lately (see editsSince), newest first, among
 * those `viewerId` can open, for `userIds` (the cards). Trashed pages and templates are left out.
 */
async function recentPagesByPerson(viewerId: string, workspaceId: string, userIds: string[], now: Date) {
  const since = new Date(now.getTime() - RECENT_DAYS * 24 * 60 * 60 * 1000);
  const rows = await db.execute<{
    user_id: string;
    page_id: string;
    at: Date | string;
    title: string;
    icon: string | null;
    kind: string;
  }>(sql`
    with edits as (${editsSince(workspaceId, since)}),
    latest as (
      select e.user_id, e.page_id, max(e.at) as at
      from edits e
      join ${page} p on p.id = e.page_id
      where e.user_id in ${userIds} and p.archived_at is null and not p.in_template
      group by e.user_id, e.page_id
    ),
    candidates as (
      select l.*, row_number() over (partition by l.user_id order by l.at desc, l.page_id) as n
      from latest l
    ),
    visible as (
      select c.user_id, c.page_id, c.at, p.title, p.icon, p.kind,
        row_number() over (partition by c.user_id order by c.at desc, c.page_id) as n
      from candidates c
      join ${page} p on p.id = c.page_id
      where c.n <= ${RECENT_CANDIDATES} and ${accessRank(viewerId, sql`p.id`)} > 0
    )
    select user_id, page_id, at, title, icon, kind from visible where n <= ${RECENT_PER_PERSON}
    order by user_id, at desc
  `);
  const byUser = new Map<string, DirectoryPage[]>();
  for (const r of rows) {
    const entry = { id: r.page_id, title: r.title, icon: r.icon, kind: r.kind, editedAt: new Date(r.at) };
    byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), entry]);
  }
  return byUser;
}

/**
 * The people directory: the workspace's owners and members (never its guests), by name, with the
 * teamspaces and groups they are in and a few pages they edited lately. Only owners and members
 * may read it; guests get an AccessError, like the members list. What each card shows follows the
 * viewer's own access: teamspaces as the members list shows them (private ones the viewer isn't
 * in left out, see teamspacesByMember), groups (owners and members see them all), and pages the
 * viewer can open.
 */
export async function peopleDirectory(viewerId: string, workspaceId: string, now = new Date()): Promise<DirectoryPerson[]> {
  await requireMember(viewerId, workspaceId);
  const people = (await workspacePeople(workspaceId)).filter((p) => !isGuest(p.role));
  const [teamspaces, groups, recent] = await Promise.all([
    teamspacesByMember(viewerId, workspaceId),
    groupsByMember(viewerId, workspaceId),
    recentPagesByPerson(viewerId, workspaceId, people.map((p) => p.id), now),
  ]);
  return people
    .map((p) => ({
      userId: p.id,
      name: p.name,
      email: p.email,
      image: p.image,
      role: p.role,
      teamspaces: teamspaces.get(p.id) ?? [],
      groups: groups.get(p.id) ?? [],
      recentPages: recent.get(p.id) ?? [],
    }))
    .sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));
}

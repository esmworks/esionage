import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { page, pageSnapshot, type WorkspaceRole } from "@/db/schema";
import {
  type AnalyticsPage,
  type AnalyticsPeriod,
  type AnalyticsPerson,
  type AnalyticsReport,
  periodStart,
} from "@/lib/analytics";
import { AUTO_SNAPSHOT_INTERVAL_MS } from "@/lib/collab-constants";
import { accessRank, isGuest, requireMembership } from "@/server/access";
import { workspacePeople } from "@/server/workspaces";

/** How many of the most edited pages the report lists. */
const TOP_PAGES = 20;

/**
 * SQL: every edit made in the workspace since `since`, one row each (`user_id`, `page_id`, `at`),
 * worked out from what is stored anyway; nothing is recorded for analytics.
 *
 * - Page history versions (`page_snapshot`), by who caused them: saved automatically at most every
 *   AUTO_SNAPSHOT_INTERVAL_MS while someone edits, and before an app, the AI assistant or a
 *   restore changes the page. A version someone saved by hand (`manual`) changes nothing, so it
 *   isn't an edit. One version stands for all the typing in its interval, so these are counts of
 *   editing sessions rather than keystrokes.
 * - Each page's latest change (`page.updated_by`/`updated_at`, what the members list's "last edit"
 *   reads): the only record of changes history doesn't version, such as a database row's values,
 *   a new page, a move or a trashing. It counts unless a version the same person saved within the
 *   interval of it already stands for it (the automatic one right after it, or the one an app's
 *   write saved just before).
 *
 * Both are read through the workspace's pages (`page_workspace_parent_idx`) and each page's
 * versions by time (`page_snapshot_page_idx`), so the work is bounded by the workspace and period.
 * History keeps ordinary versions 90 days and 200 per page (HISTORY_RETENTION), which is why the
 * longest period is 90 days.
 */
export function editsSince(workspaceId: string, since: Date): SQL {
  const from = since.toISOString();
  const interval = `${AUTO_SNAPSHOT_INTERVAL_MS / 1000} seconds`;
  return sql`
    select s.created_by as user_id, s.page_id, s.created_at as at
    from ${pageSnapshot} s
    join ${page} p on p.id = s.page_id
    where p.workspace_id = ${workspaceId}
      and s.created_at >= ${from}::timestamptz
      and s.created_by is not null
      and s.reason <> 'manual'
    union all
    select p.updated_by as user_id, p.id as page_id, p.updated_at as at
    from ${page} p
    where p.workspace_id = ${workspaceId}
      and p.updated_at >= ${from}::timestamptz
      and p.updated_by is not null
      and not exists (
        select 1 from ${pageSnapshot} v
        where v.page_id = p.id
          and v.created_by = p.updated_by
          and v.reason <> 'manual'
          and v.created_at between p.updated_at - ${interval}::interval and p.updated_at + ${interval}::interval
      )
  `;
}

const toDate = (value: Date | string | null) => (value === null ? null : new Date(value));

/**
 * The workspace's analytics over the last `days`: who edited how much, and the most edited pages.
 * Owners only (AccessError for anyone else, whether the workspace exists or not). Pages the owner
 * can't open themselves, such as someone's private pages, are counted without their title.
 */
export async function workspaceAnalytics(
  userId: string,
  workspaceId: string,
  days: AnalyticsPeriod,
  now = new Date(),
): Promise<AnalyticsReport> {
  await requireMembership(userId, workspaceId, "owner");
  const since = periodStart(now, days);
  const edits = editsSince(workspaceId, since);

  const [people, byPerson, topPages] = await Promise.all([
    workspacePeople(workspaceId),
    db.execute<{ user_id: string; edits: number; pages: number; last_at: Date | string }>(sql`
      with edits as (${edits})
      select user_id, count(*)::int as edits, count(distinct page_id)::int as pages, max(at) as last_at
      from edits
      group by user_id
    `),
    // Access is asked of the top pages only, after the limit.
    db.execute<{
      page_id: string;
      edits: number;
      editors: number;
      last_at: Date | string;
      page_count: number;
      total_edits: number;
      title: string;
      icon: string | null;
      kind: string;
      level: number;
    }>(sql`
      with edits as (${edits}),
      per_page as (
        select page_id, count(*)::int as edits, count(distinct user_id)::int as editors, max(at) as last_at
        from edits
        group by page_id
      ),
      top as (
        select pp.*, count(*) over ()::int as page_count, (sum(pp.edits) over ())::int as total_edits
        from per_page pp
        order by pp.edits desc, pp.last_at desc, pp.page_id
        limit ${TOP_PAGES}
      )
      select top.*, p.title, p.icon, p.kind, ${accessRank(userId, sql`p.id`)} as level
      from top
      join ${page} p on p.id = top.page_id
      order by top.edits desc, top.last_at desc, top.page_id
    `),
  ]);

  const counts = new Map(byPerson.map((r) => [r.user_id, r]));
  const listed: AnalyticsPerson[] = people.map((p) => {
    const c = counts.get(p.id);
    return {
      userId: p.id,
      name: p.name,
      email: p.email,
      image: p.image,
      role: p.role,
      edits: c ? Number(c.edits) : 0,
      pages: c ? Number(c.pages) : 0,
      lastEditAt: toDate(c?.last_at ?? null),
    };
  });
  listed.sort((a, b) => b.edits - a.edits || (a.name || a.email).localeCompare(b.name || b.email));

  const pages: AnalyticsPage[] = topPages.map((r) => {
    const visible = Number(r.level) > 0;
    return {
      id: visible ? r.page_id : null,
      title: visible ? r.title : null,
      icon: visible ? r.icon : null,
      kind: visible ? r.kind : null,
      edits: Number(r.edits),
      editors: Number(r.editors),
      lastEditAt: new Date(r.last_at),
    };
  });

  const counted = (role: WorkspaceRole) => !isGuest(role);
  return {
    days,
    since,
    totalEdits: topPages.length ? Number(topPages[0].total_edits) : 0,
    pagesEdited: topPages.length ? Number(topPages[0].page_count) : 0,
    activeMembers: listed.filter((p) => counted(p.role) && p.edits > 0).length,
    memberCount: listed.filter((p) => counted(p.role)).length,
    people: listed,
    pages,
  };
}

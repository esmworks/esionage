import { and, asc, desc, eq, ilike, inArray, isNull, lte, ne, notInArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { page, pageLink, pageMention, pagePublication, pageReminder, user, type PageKind } from "@/db/schema";
import { bodyReferences } from "@/lib/mentions";
import { accessRank, getMembership, isGuest, levelFromRank, pageVisibleTo, requirePageAccess, workspacesHeldBack } from "@/server/access";
import { recordMentions, recordReminder, withdrawMentions } from "@/server/notifications";
import { workspacePeople } from "@/server/workspaces";

/**
 * Mentions, page links and reminders on the server. The page's document holds them; each time the
 * collab server saves a page (the one path every edit takes, whoever made it) `syncPageReferences`
 * brings the indexes in line: the page's outgoing links (backlinks), the person mentions it has
 * notified about, and the reminders set on its dates.
 */

/** A reminder set on a date already past this long ago is kept but never sent. */
const LATE_REMINDER_MS = 10 * 60_000;
/** How often the server looks for reminders that are due. */
const REMINDER_SWEEP_MS = 30_000;

type Blocks = Parameters<typeof bodyReferences>[0];

/**
 * Brings the page's links, mentions and reminders in line with its body. `actorId` is who made the
 * latest change (the collab connection's user): the author of new mentions and the owner of
 * reminders they set. Never throws: the page itself is already saved.
 */
export async function syncPageReferences(
  pageId: string,
  workspaceId: string,
  blocks: Blocks,
  actorId: string | null,
  locale: string | null = null,
) {
  try {
    const refs = bodyReferences(blocks);
    await syncLinks(pageId, refs.pageIds);
    await syncMentions(pageId, workspaceId, refs.people, actorId, locale);
    await syncReminders(pageId, refs.reminders, actorId);
  } catch (error) {
    console.error(`could not update the mentions and links of page ${pageId}`, error);
  }
}

async function syncLinks(pageId: string, targetIds: string[]) {
  const wanted = targetIds.filter((id) => id !== pageId);
  const existing = new Set(
    (await db.select({ id: pageLink.targetId }).from(pageLink).where(eq(pageLink.sourceId, pageId))).map((r) => r.id),
  );
  const added = wanted.filter((id) => !existing.has(id));
  const kept = new Set(wanted);
  const removed = [...existing].filter((id) => !kept.has(id));
  if (removed.length) await db.delete(pageLink).where(and(eq(pageLink.sourceId, pageId), inArray(pageLink.targetId, removed)));
  if (!added.length) return;
  // Links to pages that don't exist (deleted, or made up) show as broken links but index nothing.
  const found = await db.select({ id: page.id }).from(page).where(inArray(page.id, added));
  if (found.length) {
    await db
      .insert(pageLink)
      .values(found.map((p) => ({ sourceId: pageId, targetId: p.id })))
      .onConflictDoNothing();
  }
}

async function syncMentions(
  pageId: string,
  workspaceId: string,
  people: { key: string; userId: string }[],
  actorId: string | null,
  locale: string | null,
) {
  const seen = await db
    .select({ mentionId: pageMention.mentionId, userId: pageMention.userId })
    .from(pageMention)
    .where(eq(pageMention.pageId, pageId));
  const seenIds = new Set(seen.map((r) => r.mentionId));
  const current = new Set(people.map((p) => p.key));

  // A mention taken out before the person read about it takes its notification with it, and is
  // forgotten, so mentioning them again notifies them again.
  const gone = seen.filter((r) => !current.has(r.mentionId)).map((r) => r.mentionId);
  if (gone.length) {
    const withdrawn = await withdrawMentions(workspaceId, pageId, gone);
    if (withdrawn.length) {
      await db.delete(pageMention).where(and(eq(pageMention.pageId, pageId), inArray(pageMention.mentionId, withdrawn)));
    }
  }

  const fresh = people.filter((p) => !seenIds.has(p.key));
  if (!fresh.length) return;
  // Only real people are remembered (a made-up id in a document mentions no one).
  const known = new Set(
    (await db.select({ id: user.id }).from(user).where(inArray(user.id, [...new Set(fresh.map((p) => p.userId))]))).map((r) => r.id),
  );
  const added = fresh.filter((p) => known.has(p.userId));
  if (!added.length) return;
  const inserted = await db
    .insert(pageMention)
    .values(added.map((p) => ({ pageId, mentionId: p.key, userId: p.userId })))
    .onConflictDoNothing()
    .returning({ mentionId: pageMention.mentionId, userId: pageMention.userId });
  // Mentioning oneself notifies no one; recordMentions also checks each person can view the page.
  const notify = inserted.filter((m) => m.userId !== actorId);
  if (notify.length) await recordMentions(actorId, workspaceId, pageId, notify, locale);
}

async function syncReminders(pageId: string, reminders: { key: string; date: string; remindAt: string }[], actorId: string | null) {
  const rows = await db.select().from(pageReminder).where(eq(pageReminder.pageId, pageId));
  const byKey = new Map(rows.map((r) => [r.mentionId, r]));
  const now = Date.now();
  // A reminder already past (a date in the past, or a copy of an old page) is recorded as done.
  const doneIfLate = (at: Date) => (at.getTime() < now - LATE_REMINDER_MS ? new Date() : null);
  for (const reminder of reminders) {
    const remindAt = new Date(reminder.remindAt);
    const row = byKey.get(reminder.key);
    if (!row) {
      // Whoever set it gets it; a change nobody signed in made owns nothing.
      if (!actorId) continue;
      await db
        .insert(pageReminder)
        .values({ pageId, mentionId: reminder.key, userId: actorId, date: reminder.date, remindAt, notifiedAt: doneIfLate(remindAt) })
        .onConflictDoNothing();
      continue;
    }
    if (row.remindAt.getTime() === remindAt.getTime() && row.date === reminder.date) continue;
    await db
      .update(pageReminder)
      .set({ remindAt, date: reminder.date, userId: actorId ?? row.userId, notifiedAt: doneIfLate(remindAt) })
      .where(eq(pageReminder.id, row.id));
  }
  // Reminders whose date (or reminder) went away: unsent ones go too, sent ones stay as a record.
  const keys = reminders.map((r) => r.key);
  await db
    .delete(pageReminder)
    .where(
      and(
        eq(pageReminder.pageId, pageId),
        isNull(pageReminder.notifiedAt),
        keys.length ? notInArray(pageReminder.mentionId, keys) : undefined,
      ),
    );
}

/**
 * Sends the reminders that are due: each becomes an inbox notification (and an email) for the
 * person who set it, if they can still open the page. Claiming a reminder (setting `notifiedAt`)
 * before notifying means it is sent at most once, even with two sweeps racing.
 */
export async function deliverDueReminders(now = new Date()) {
  const due = await db
    .update(pageReminder)
    .set({ notifiedAt: now })
    .where(and(isNull(pageReminder.notifiedAt), lte(pageReminder.remindAt, now)))
    .returning({ pageId: pageReminder.pageId, mentionId: pageReminder.mentionId, userId: pageReminder.userId });
  for (const reminder of due) {
    try {
      await recordReminder(reminder.userId, reminder.pageId, reminder.mentionId);
    } catch (error) {
      console.error("could not send a reminder", error);
    }
  }
  return due.length;
}

let sweeping = false;

/** Server only: sends reminders as they fall due, including any missed while the server was down. */
export function startReminders() {
  const sweep = async () => {
    if (sweeping) return;
    sweeping = true;
    try {
      await deliverDueReminders();
    } catch (error) {
      console.error("could not deliver reminders", error);
    } finally {
      sweeping = false;
    }
  };
  void sweep();
  const timer = setInterval(() => void sweep(), REMINDER_SWEEP_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}

// ---------------------------------------------------------------------------------------------
// Reading mentions

/**
 * How a mentioned page shows for `userId`: its live title and icon when they may view it, "noAccess"
 * (nothing else, not even whether it exists) when they may not, "deleted" when it is gone or in the
 * trash.
 */
export type PageRef =
  | { id: string; status: "ok"; workspaceId: string; title: string; icon: string | null; kind: PageKind }
  | { id: string; status: "noAccess" | "deleted" };

const MAX_REFS = 200;

/**
 * `standing`: what the user's access allows, whoever is looking (a publisher's, for published
 * pages); otherwise pages of a workspace whose two-step policy holds back this request's session
 * read as no access too.
 */
export async function resolvePageRefs(
  userId: string,
  pageIds: string[],
  { standing = false }: { standing?: boolean } = {},
): Promise<PageRef[]> {
  const ids = [...new Set(pageIds.filter((id) => typeof id === "string" && id && id.length <= 128))].slice(0, MAX_REFS);
  if (!ids.length) return [];
  const rows = await db
    .select({
      id: page.id,
      workspaceId: page.workspaceId,
      title: page.title,
      icon: page.icon,
      kind: page.kind,
      archived: sql<boolean>`${page.archivedAt} is not null`,
      level: accessRank(userId, sql`${page.id}`),
    })
    .from(page)
    .where(inArray(page.id, ids));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const heldBack = standing
    ? new Set<string>()
    : await workspacesHeldBack(
        userId,
        rows.filter((r) => levelFromRank(r.level) !== "none").map((r) => r.workspaceId),
      );
  return ids.map((id): PageRef => {
    const row = byId.get(id);
    // A page the user can't see reads the same whether it exists or not.
    if (row && (levelFromRank(row.level) === "none" || heldBack.has(row.workspaceId))) return { id, status: "noAccess" };
    if (!row || row.archived) return { id, status: "deleted" };
    return { id, status: "ok", workspaceId: row.workspaceId, title: row.title, icon: row.icon, kind: row.kind };
  });
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const PAGE_LINK = /\[((?:[^\]\\\n]|\\.)*)\]\(\s*<?(\/w\/[\w-]{1,128}\/p\/([\w-]{1,128}))>?\s*\)/g;

/**
 * Stored Markdown with the links of page mentions and page links (written with the neutral text
 * "page", see lib/mentions) labelled for `userId`: the page's live title and address when they may
 * view it, "No access" or "Deleted page" (and the stored address) otherwise. For MCP reads and
 * exports, so the Markdown names only what its reader could open. Fenced code is left alone.
 */
export async function labelPageLinks(
  userId: string,
  markdown: string,
  labels: { untitled: string; noAccess: string; deleted: string } = { untitled: "Untitled", noAccess: "No access", deleted: "Deleted page" },
): Promise<string> {
  if (!markdown.includes("/p/")) return markdown;
  const lines = markdown.split("\n");
  const code: boolean[] = [];
  let fence: string | null = null;
  for (const line of lines) {
    const open = FENCE.exec(line);
    if (fence) {
      code.push(true);
      if (open && open[1][0] === fence[0] && open[1].length >= fence.length && !line.trim().slice(open[0].trim().length)) fence = null;
      continue;
    }
    if (open) fence = open[1];
    code.push(Boolean(open));
  }
  const ids = new Set<string>();
  lines.forEach((line, i) => {
    if (!code[i]) for (const match of line.matchAll(PAGE_LINK)) ids.add(match[3]);
  });
  if (!ids.size) return markdown;
  const byId = new Map((await resolvePageRefs(userId, [...ids])).map((ref) => [ref.id, ref]));
  const escape = (text: string) => text.replace(/[[\]\\]/g, "\\$&");
  return lines
    .map((line, i) =>
      code[i]
        ? line
        : line.replace(PAGE_LINK, (whole, _text: string, path: string, id: string) => {
            const ref = byId.get(id);
            if (!ref) return whole;
            if (ref.status === "ok") return `[${escape(ref.title.trim() || labels.untitled)}](/w/${ref.workspaceId}/p/${ref.id})`;
            return `[${escape(ref.status === "noAccess" ? labels.noAccess : labels.deleted)}](${path})`;
          }),
    )
    .join("\n");
}

export type Backlink = { id: string; workspaceId: string; title: string; icon: string | null; kind: PageKind };

/** Pages whose body mentions or links to `pageId`, as far as the user can see them. */
export async function listBacklinks(userId: string, pageId: string): Promise<Backlink[]> {
  await requirePageAccess(userId, pageId, "view");
  return db
    .select({ id: page.id, workspaceId: page.workspaceId, title: page.title, icon: page.icon, kind: page.kind })
    .from(pageLink)
    .innerJoin(page, eq(page.id, pageLink.sourceId))
    .where(and(eq(pageLink.targetId, pageId), isNull(page.archivedAt), eq(page.inTemplate, false), pageVisibleTo(userId)))
    .orderBy(asc(page.title), asc(page.id))
    .limit(100);
}

export type MentionCandidates = {
  people: { id: string; name: string }[];
  pages: { id: string; title: string; icon: string | null; kind: PageKind }[];
};

/**
 * What the editor's @ menu offers on a page: people of the workspace (members only: guests don't
 * get to see who is in it) and pages the user can view, matching `query`.
 */
export async function mentionCandidates(userId: string, pageId: string, query: string): Promise<MentionCandidates> {
  const target = await requirePageAccess(userId, pageId, "edit");
  const membership = await getMembership(userId, target.workspaceId);
  const q = typeof query === "string" ? query.trim().slice(0, 100) : "";
  const lower = q.toLocaleLowerCase();
  const people =
    membership && !isGuest(membership.role)
      ? (await workspacePeople(target.workspaceId))
          .filter((p) => !lower || p.name.toLocaleLowerCase().includes(lower) || p.email.toLocaleLowerCase().startsWith(lower))
          .sort((a, b) => (a.id === userId ? 1 : 0) - (b.id === userId ? 1 : 0) || a.name.localeCompare(b.name))
          .slice(0, 6)
          .map((p) => ({ id: p.id, name: p.name }))
      : [];
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const pages = await db
    .select({ id: page.id, title: page.title, icon: page.icon, kind: page.kind })
    .from(page)
    .where(
      and(
        eq(page.workspaceId, target.workspaceId),
        isNull(page.archivedAt),
        eq(page.inTemplate, false),
        ne(page.id, pageId),
        q ? ilike(page.title, like) : undefined,
        pageVisibleTo(userId),
      ),
    )
    .orderBy(q ? sql`position(lower(${lower}) in lower(${page.title}))` : desc(page.updatedAt), desc(page.updatedAt))
    .limit(q ? 8 : 5);
  return { people, pages };
}

/** People Markdown written into a page may mention by name: everyone in its workspace. */
export async function mentionablePeople(pageId: string) {
  const [row] = await db.select({ workspaceId: page.workspaceId }).from(page).where(eq(page.id, pageId)).limit(1);
  if (!row) return [];
  return (await workspacePeople(row.workspaceId)).map((p) => ({ id: p.id, name: p.name }));
}

// ---------------------------------------------------------------------------------------------
// Published pages

/**
 * How a published page shows the pages it mentions (see published-body.ts): a page published with
 * it (or published on its own) is a link to its public address; any other page is plain text, its
 * title when the publisher may see it and a note otherwise, so the publication shows nothing its
 * publisher couldn't.
 */
export async function publishedPageRefs(
  publisher: string,
  pageIds: string[],
  {
    inPublication,
    labels,
  }: {
    /** The page's address when it is published with this publication, else null. */
    inPublication: (pageId: string) => Promise<string | null>;
    labels: { untitled: string; private: string; deleted: string };
  },
) {
  const refs = await resolvePageRefs(publisher, pageIds, { standing: true });
  const own = new Map(
    refs.length
      ? (
          await db
            .select({ pageId: pagePublication.pageId, token: pagePublication.token })
            .from(pagePublication)
            .where(inArray(pagePublication.pageId, refs.map((r) => r.id)))
        ).map((r) => [r.pageId, `/s/${r.token}`] as const)
      : [],
  );
  const out = new Map<string, { text: string; href: string | null }>();
  for (const ref of refs) {
    if (ref.status !== "ok") {
      out.set(ref.id, { text: ref.status === "deleted" ? labels.deleted : labels.private, href: null });
      continue;
    }
    const href = (await inPublication(ref.id)) ?? own.get(ref.id) ?? null;
    out.set(ref.id, { text: ref.title.trim() || labels.untitled, href });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Copies

/**
 * Carries the mention bookkeeping of copied pages over to their copies (see duplicate.ts), so
 * people mentioned in the source aren't notified again and backlinks show the copies right away.
 * Reminders don't carry over: the copies' documents are stripped of them.
 */
export async function copyReferences(tx: Pick<typeof db, "execute">, pairs: { id: string; source_id: string }[]) {
  if (!pairs.length) return;
  const map = JSON.stringify(pairs.map((p) => ({ id: p.id, source_id: p.source_id })));
  await tx.execute(sql`
    insert into ${pageMention} (page_id, mention_id, user_id)
    select m.id, pm.mention_id, pm.user_id
    from jsonb_to_recordset(${map}::jsonb) as m(id text, source_id text)
    join ${pageMention} pm on pm.page_id = m.source_id
    on conflict do nothing
  `);
  await tx.execute(sql`
    insert into ${pageLink} (source_id, target_id)
    select m.id, pl.target_id
    from jsonb_to_recordset(${map}::jsonb) as m(id text, source_id text)
    join ${pageLink} pl on pl.source_id = m.source_id
    on conflict do nothing
  `);
}

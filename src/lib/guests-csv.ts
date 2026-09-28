import type { Guest } from "@/server/guests";

export const GUESTS_CSV_HEADER = [
  "name",
  "email",
  "status",
  "added_at",
  "invited_by",
  "pages_not_shown",
  "page",
  "page_url",
  "access",
  "level",
  "shared_by",
  "shared_at",
  "in_trash",
] as const;

type Cell = string | number | Date | null;

/**
 * Settings > Guests as spreadsheet rows: one per page a guest was given (`access` "entry") or is
 * waiting for (`access` "invitation"), and one with the page columns empty for a guest with
 * neither, so every guest is in the file. Only what the viewer was shown goes in: pages they
 * can't see themselves are only counted (`pages_not_shown`).
 */
export function guestsCsvRows(guests: Guest[], pageUrl: (pageId: string) => string): Cell[][] {
  const rows: Cell[][] = [[...GUESTS_CSV_HEADER]];
  for (const g of guests) {
    const person: Cell[] = [
      g.name,
      g.email,
      g.userId ? "joined" : "invited",
      g.addedAt,
      g.invitedBy?.name ?? null,
      g.hiddenPages + g.hiddenInvitations,
    ];
    const pages = [
      ...g.pages.map((p) => ({ p, access: "entry" })),
      ...g.invitations.map((p) => ({ p, access: "invitation" })),
    ];
    for (const { p, access } of pages) {
      rows.push([...person, p.title, pageUrl(p.pageId), access, p.level, p.by?.name ?? null, p.at, p.inTrash ? "yes" : "no"]);
    }
    if (!pages.length) rows.push([...person, null, null, null, null, null, null, null]);
  }
  return rows;
}

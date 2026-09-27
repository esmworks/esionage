import { AccessError, hasLevel, requireMembership, resolvePageAccess } from "@/server/access";

export type DocTarget = { kind: "page" | "ws" | "db"; id: string };

/** `page:<id>` is a page's live document; `ws:<id>` and `db:<id>` only carry change signals. */
export function parseDocName(name: string): DocTarget | null {
  const match = /^(page|ws|db):([\w-]+)$/.exec(name);
  return match ? { kind: match[1] as DocTarget["kind"], id: match[2] } : null;
}

/**
 * Whether the user may open a collab document: a workspace's signals need membership, a page or
 * database needs view access, and without edit access that connection is read-only. Throws
 * AccessError otherwise. Checked once, when the connection opens.
 */
export async function authorizeCollab(userId: string, target: DocTarget): Promise<{ readOnly: boolean }> {
  if (target.kind === "ws") {
    await requireMembership(userId, target.id);
    return { readOnly: false };
  }
  const { level } = await resolvePageAccess(userId, target.id);
  if (!hasLevel(level, "view")) throw new AccessError();
  return { readOnly: !hasLevel(level, "edit") };
}

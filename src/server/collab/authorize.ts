import {
  AccessError,
  findMembership,
  hasLevel,
  pageAccessOf,
  twoFactorPolicyApplies,
  TwoFactorRequiredError,
} from "@/server/access";

export type DocTarget = { kind: "page" | "ws" | "db"; id: string };

/** `page:<id>` is a page's live document; `ws:<id>` and `db:<id>` only carry change signals. */
export function parseDocName(name: string): DocTarget | null {
  const match = /^(page|ws|db):([\w-]+)$/.exec(name);
  return match ? { kind: match[1] as DocTarget["kind"], id: match[2] } : null;
}

/**
 * Whether the user may open a collab document: a workspace's signals need membership, a page or
 * database needs view access, and without edit access that connection is read-only. A workspace
 * that requires two-step verification also needs a session that passes it (`strong`, see
 * sessionPassesTwoFactor). Throws AccessError otherwise (TwoFactorRequiredError for the policy).
 * Checked when the connection opens; turning the policy on closes the others (disconnectHeldBack).
 */
export async function authorizeCollab(
  userId: string,
  target: DocTarget,
  { strong = false }: { strong?: boolean } = {},
): Promise<{ readOnly: boolean }> {
  if (target.kind === "ws") {
    if (!(await findMembership(userId, target.id))) throw new AccessError();
    await holdBack(userId, target.id, strong);
    return { readOnly: false };
  }
  const { page, level } = await pageAccessOf(userId, target.id);
  if (!page || !hasLevel(level, "view")) throw new AccessError();
  await holdBack(userId, page.workspaceId, strong);
  return { readOnly: !hasLevel(level, "edit") };
}

async function holdBack(userId: string, workspaceId: string, strong: boolean) {
  if (!strong && (await twoFactorPolicyApplies(userId, workspaceId))) throw new TwoFactorRequiredError(workspaceId);
}

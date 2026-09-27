/**
 * The sidebar's sections besides the teamspaces (whose section is the teamspace's id): the user's
 * own pages outside any teamspace, and pages shared with them from elsewhere.
 */
export const PRIVATE_SECTION = "private";
export const SHARED_SECTION = "shared";

/** A teamspace id, PRIVATE_SECTION or SHARED_SECTION. */
export type TreeSection = string;

/** A page the user can see, as far as placing it in the sidebar goes. */
export type SectionRow = {
  id: string;
  parentId: string | null;
  /** Null for private pages. */
  teamspaceId: string | null;
  /** The user created it. */
  mine: boolean;
  /** Shared with the user by name (an entry of their own above "no access"). */
  shared: boolean;
};

export type Placement = { section: TreeSection; parentId: string | null };

/**
 * Where each visible page shows in the sidebar, given the teamspaces the user is in (`joined`):
 * - under its parent, when the parent is placed;
 * - at the top of its teamspace, when they are in it;
 * - at the top of "private", for their own pages outside any teamspace;
 * - at the top of "shared", for pages shared with them by name that are in neither, and for
 *   other people's private pages whose parent they can't see.
 * Anything else (a page of an open teamspace they haven't joined) is left out, like the teamspace.
 */
export function placeInSections(rows: SectionRow[], joined: ReadonlySet<string>): Map<string, Placement> {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const placed = new Map<string, Placement | null>();
  const place = (r: SectionRow): Placement | null => {
    const known = placed.get(r.id);
    if (known !== undefined) return known;
    placed.set(r.id, null); // a cycle can't loop forever
    const parent = r.parentId ? byId.get(r.parentId) : undefined;
    const above = parent ? place(parent) : null;
    let result: Placement | null;
    if (above) result = { section: above.section, parentId: parent!.id };
    else if (parent && !r.shared) result = null;
    else if (r.teamspaceId && joined.has(r.teamspaceId) && !parent) result = { section: r.teamspaceId, parentId: null };
    else if (!r.teamspaceId && r.mine && !parent) result = { section: PRIVATE_SECTION, parentId: null };
    else if (r.shared || (!r.teamspaceId && !parent)) result = { section: SHARED_SECTION, parentId: null };
    else result = null;
    placed.set(r.id, result);
    return result;
  };
  const out = new Map<string, Placement>();
  for (const r of rows) {
    const where = place(r);
    if (where) out.set(r.id, where);
  }
  return out;
}

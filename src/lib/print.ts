/**
 * The print view (`/print/<pageId>`): a page drawn like its published version, for the browser's
 * "Save as PDF". See app/print and server/print.ts.
 */

/** Most pages one print holds with its subpages; the rest are left out with a note. */
export const PRINT_MAX_PAGES = 100;

/**
 * The print view's address. `subpages` prints the pages under it too; `auto` opens the browser's
 * print dialog once everything has loaded (the page menu's "Export as PDF").
 */
export function printPath(pageId: string, { subpages = false, auto = false }: { subpages?: boolean; auto?: boolean } = {}) {
  const query = new URLSearchParams();
  if (subpages) query.set("subpages", "1");
  if (auto) query.set("auto", "1");
  const search = query.toString();
  return `/print/${encodeURIComponent(pageId)}${search ? `?${search}` : ""}`;
}

export type PrintTreeRow = { id: string; parentId: string | null; position: number; createdAt: Date | string };

/**
 * The pages to print, in reading order: `rootId` first, then each page followed by its subpages
 * (depth first, in sidebar order: position, then creation time), with how deep each lies under the
 * root. Rows that don't hang from the root are ignored. At most `limit` pages; `truncated` says
 * whether any were left out.
 */
export function printOrder(
  rootId: string,
  rows: PrintTreeRow[],
  limit = PRINT_MAX_PAGES,
): { pages: { id: string; depth: number }[]; truncated: boolean } {
  const children = new Map<string, PrintTreeRow[]>();
  for (const row of rows) {
    if (!row.parentId || row.id === rootId) continue;
    const list = children.get(row.parentId) ?? [];
    list.push(row);
    children.set(row.parentId, list);
  }
  const time = (value: Date | string) => new Date(value).getTime();
  for (const list of children.values()) {
    list.sort((a, b) => a.position - b.position || time(a.createdAt) - time(b.createdAt) || (a.id < b.id ? -1 : 1));
  }
  const pages: { id: string; depth: number }[] = [];
  const seen = new Set<string>();
  let truncated = false;
  // An explicit stack rather than recursion: a deep tree can't overflow it.
  const stack: { id: string; depth: number }[] = [{ id: rootId, depth: 0 }];
  while (stack.length) {
    const next = stack.pop()!;
    if (seen.has(next.id)) continue;
    if (pages.length >= limit) {
      truncated = true;
      break;
    }
    seen.add(next.id);
    pages.push(next);
    const below = children.get(next.id) ?? [];
    for (let i = below.length - 1; i >= 0; i--) stack.push({ id: below[i].id, depth: next.depth + 1 });
  }
  return { pages, truncated };
}

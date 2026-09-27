// Pages the user just created, so the page view can put the caret in the title the way a fresh
// page expects. It lives in memory, not in the URL: a reload or a later visit opens the page as usual.
const created = new Map<string, number>();

// A mark nobody picked up (the page never became editable) must not grab focus on a later visit.
const TTL_MS = 30_000;

/** Call right before navigating to a page that was just created. */
export function markNewPage(id: string) {
  created.set(id, Date.now());
}

/** Whether `id` was just created; the mark is used up either way. */
export function takeNewPage(id: string) {
  const at = created.get(id);
  created.delete(id);
  return at !== undefined && Date.now() - at < TTL_MS;
}

/**
 * The ids after moving `moved` next to `target` (before or after it), as a drag and drop does. A
 * drop on itself or on an id that isn't there changes nothing.
 */
export function moveBeside<T extends string>(ids: readonly T[], moved: T, target: T, side: "before" | "after"): T[] {
  const rest = ids.filter((id) => id !== moved);
  const at = rest.indexOf(target);
  if (at === -1 || moved === target || !ids.includes(moved)) return [...ids];
  rest.splice(side === "before" ? at : at + 1, 0, moved);
  return rest;
}

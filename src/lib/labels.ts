export function pageLabel(title: string | null | undefined) {
  return title?.trim() || "Untitled";
}

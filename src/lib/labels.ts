/** Display title for a page. UI callers pass the translated "Untitled"; MCP output stays English. */
export function pageLabel(title: string | null | undefined, untitled = "Untitled") {
  return title?.trim() || untitled;
}

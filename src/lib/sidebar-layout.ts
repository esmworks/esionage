export const SIDEBAR_COOKIE = "leafdesk-sidebar";
export const SIDEBAR_WIDTH = { min: 200, default: 256, max: 420 } as const;

/** Desktop sidebar layout, kept in a cookie so the server renders it the way it was left. */
export type SidebarLayout = { collapsed: boolean; width: number };

export function clampSidebarWidth(width: number) {
  return Math.round(Math.min(SIDEBAR_WIDTH.max, Math.max(SIDEBAR_WIDTH.min, width)));
}

/** Cookie format: `<collapsed 0|1>:<width px>`. Anything unreadable falls back to the defaults. */
export function parseSidebarCookie(value: string | undefined): SidebarLayout {
  const [collapsed, width] = (value ?? "").split(":");
  const w = Number(width);
  return {
    collapsed: collapsed === "1",
    width: Number.isFinite(w) && w > 0 ? clampSidebarWidth(w) : SIDEBAR_WIDTH.default,
  };
}

export function formatSidebarCookie(layout: SidebarLayout) {
  return `${layout.collapsed ? 1 : 0}:${clampSidebarWidth(layout.width)}`;
}

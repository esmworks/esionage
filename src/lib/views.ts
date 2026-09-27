import type { CardSize, ViewConfig, ViewCover, ViewType } from "@/db/schema/app";

/** Every kind of database view, in the order the "Add a view" menu lists them. */
export const VIEW_TYPES = ["table", "board", "calendar", "gallery", "list"] as const satisfies readonly ViewType[];
export const CARD_SIZES = ["small", "medium", "large"] as const satisfies readonly CardSize[];
export const COVER_SOURCES = ["first_image", "none"] as const satisfies readonly ViewCover["source"][];

export function isViewType(value: unknown): value is ViewType {
  return VIEW_TYPES.includes(value as ViewType);
}

/** Default English names for views created without one (the UI names them in its own language). */
export const DEFAULT_VIEW_NAMES: Record<ViewType, string> = {
  table: "Table",
  board: "Board",
  calendar: "Calendar",
  gallery: "Gallery",
  list: "List",
};

export function galleryCover(config: Pick<ViewConfig, "cover">): ViewCover["source"] {
  return config.cover?.source === "none" ? "none" : "first_image";
}

/**
 * Why the layout settings of a view config are malformed, or null. Configs come from the client
 * and from MCP, and a bad value would break every viewer. Property ids aren't checked here: views
 * fall back to a default when a property is missing (e.g. deleted meanwhile).
 */
export function layoutConfigError(config: ViewConfig): string | null {
  const c = config as Record<string, unknown>;
  for (const key of ["groupBy", "dateBy"] as const) {
    if (c[key] !== undefined && typeof c[key] !== "string") return `${key} must be a property id`;
  }
  if (c.cardSize !== undefined && !CARD_SIZES.includes(c.cardSize as CardSize)) {
    return `Card size must be one of: ${CARD_SIZES.join(", ")}`;
  }
  if (c.cover !== undefined) {
    const cover = c.cover as { source?: unknown } | null;
    if (!cover || typeof cover !== "object" || !COVER_SOURCES.includes(cover.source as ViewCover["source"])) {
      return `Cover must be one of: ${COVER_SOURCES.join(", ")}`;
    }
  }
  return null;
}

import type { CardSize, TimelineZoom, ViewConfig, ViewCover, ViewType } from "@/db/schema/app";
import { formConfigError } from "./forms";

/** Every kind of database view, in the order the "Add a view" menu lists them. */
export const VIEW_TYPES = ["table", "board", "calendar", "gallery", "list", "timeline", "form"] as const satisfies readonly ViewType[];
export const CARD_SIZES = ["small", "medium", "large"] as const satisfies readonly CardSize[];
export const COVER_SOURCES = ["first_image", "none"] as const satisfies readonly ViewCover["source"][];
export const TIMELINE_ZOOMS = ["day", "week", "month"] as const satisfies readonly TimelineZoom[];

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
  timeline: "Timeline",
  form: "Form",
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
  for (const key of ["groupBy", "dateBy", "endDateBy"] as const) {
    if (c[key] !== undefined && typeof c[key] !== "string") return `${key} must be a property id`;
  }
  if (c.zoom !== undefined && !TIMELINE_ZOOMS.includes(c.zoom as TimelineZoom)) {
    return `Zoom must be one of: ${TIMELINE_ZOOMS.join(", ")}`;
  }
  if (c.showTable !== undefined && typeof c.showTable !== "boolean") return "showTable must be true or false";
  if (c.cardSize !== undefined && !CARD_SIZES.includes(c.cardSize as CardSize)) {
    return `Card size must be one of: ${CARD_SIZES.join(", ")}`;
  }
  if (c.cover !== undefined) {
    const cover = c.cover as { source?: unknown } | null;
    if (!cover || typeof cover !== "object" || !COVER_SOURCES.includes(cover.source as ViewCover["source"])) {
      return `Cover must be one of: ${COVER_SOURCES.join(", ")}`;
    }
  }
  return formConfigError(c.form);
}

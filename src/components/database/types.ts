import type { PropertyType, SelectOption } from "@/db/schema/app";
import type { DatabaseProperty, DatabaseRowWithPosition, DatabaseView } from "@/server/databases";

export type Property = DatabaseProperty;
export type View = DatabaseView;
export type Row = DatabaseRowWithPosition;
export type { PropertyType, SelectOption };

export type DatabaseSnapshot = {
  database: { id: string; workspaceId: string; title: string; icon: string | null; archived: boolean };
  properties: Property[];
  views: View[];
  rows: Row[];
};

/** Column key for the implicit Name column (matches TITLE_KEY in lib/properties). */
export const TITLE = "title";

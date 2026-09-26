import type { PropertyType, SelectOption } from "@/db/schema/app";
import type {
  DatabaseProperty,
  DatabaseRowWithPosition,
  DatabaseView,
  RelationInput,
  RelationTarget,
  RelationTargetRow,
} from "@/server/databases";

export type Property = DatabaseProperty;
export type View = DatabaseView;
export type Row = DatabaseRowWithPosition;
export type { PropertyType, RelationInput, RelationTarget, RelationTargetRow, SelectOption };

export type DatabaseSnapshot = {
  database: { id: string; workspaceId: string; title: string; icon: string | null; archived: boolean };
  properties: Property[];
  views: View[];
  rows: Row[];
  /** Related database and its rows, per relation property id. */
  relations: Record<string, RelationTarget>;
};

/** Column key for the implicit Name column (matches TITLE_KEY in lib/properties). */
export const TITLE = "title";

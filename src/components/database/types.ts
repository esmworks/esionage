import type { PropertyType, SelectOption } from "@/db/schema/app";
import type {
  DatabaseProperty,
  DatabaseRowWithPosition,
  DatabaseView,
  PersonRef,
  RelationInput,
  RelationTarget,
  RelationTargetRow,
} from "@/server/databases";

export type Property = DatabaseProperty;
export type View = DatabaseView;
export type Row = DatabaseRowWithPosition;
export type { PersonRef, PropertyType, RelationInput, RelationTarget, RelationTargetRow, SelectOption };

export type DatabaseSnapshot = {
  database: { id: string; workspaceId: string; title: string; icon: string | null; archived: boolean; locked: boolean };
  properties: Property[];
  views: View[];
  rows: Row[];
  /** Related database and its rows, per relation property id. */
  relations: Record<string, RelationTarget>;
  /** People person properties can show and assign (see databases.getPeople). */
  people: PersonRef[];
  /** The signed-in user, who "me" in person filters stands for. */
  viewerId: string;
};

/** Column key for the implicit Name column (matches TITLE_KEY in lib/properties). */
export const TITLE = "title";

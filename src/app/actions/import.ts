"use server";

import type { PropertyType } from "@/lib/property-types";
import { requireDatabase } from "@/server/databases";
import { importTargets } from "@/server/import/csv";
import { requireUserId } from "@/server/session";

export type ImportTarget = { properties: { id: string; name: string; type: PropertyType }[] };

/**
 * The properties a CSV import can fill in a database the user may add rows to (see the import
 * dialog's column mapping): not the ones property access keeps from them or lets them only read.
 * Null when they can't, or it isn't a live database.
 */
export async function importTargetAction(databaseId: string): Promise<ImportTarget | null> {
  const userId = await requireUserId();
  try {
    const database = await requireDatabase(userId, databaseId, "edit");
    if (database.archivedAt) return null;
    const properties = await importTargets(userId, databaseId);
    return { properties: properties.map((p) => ({ id: p.id, name: p.name, type: p.type })) };
  } catch {
    return null;
  }
}

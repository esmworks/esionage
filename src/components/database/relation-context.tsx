"use client";

import { createContext, useContext } from "react";
import type { RelationTarget, RelationTargetRow } from "./types";

export type RelationContextValue = {
  workspaceId: string;
  /** The database whose rows are being shown or edited. */
  databaseId: string;
  databaseTitle: string;
  /** Related database and rows per relation property id. */
  targets: Record<string, RelationTarget>;
  /** Adds a row to a related database and returns its id. */
  createRow: (databaseId: string, title: string) => Promise<string | null>;
};

const RelationContext = createContext<RelationContextValue | null>(null);

export const RelationProvider = RelationContext.Provider;

export function useRelations() {
  return useContext(RelationContext);
}

/** Linked rows of a relation value that still exist, in the stored order. */
export function linkedRows(target: RelationTarget | undefined, value: unknown): RelationTargetRow[] {
  if (!target || !Array.isArray(value)) return [];
  const byId = new Map(target.rows.map((r) => [r.id, r]));
  return value.flatMap((id) => {
    const row = typeof id === "string" ? byId.get(id) : undefined;
    return row ? [row] : [];
  });
}

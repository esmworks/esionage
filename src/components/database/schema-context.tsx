"use client";

import { createContext, useContext } from "react";
import type { Property } from "./types";

/**
 * The properties of the database being shown, for editors that refer to other properties (the
 * formula editor lists them and checks references against them).
 */
const SchemaContext = createContext<Property[]>([]);

export const SchemaProvider = SchemaContext.Provider;

export function useSchema() {
  return useContext(SchemaContext);
}

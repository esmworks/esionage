"use client";

import type { Dictionary } from "@blocknote/core";
import { en } from "@blocknote/core/locales";
import { useLocale } from "next-intl";
import { tr } from "./tr";

const DICTIONARIES: Record<string, Dictionary> = { en, tr };

/** BlockNote's own UI strings (slash menu, toolbars, placeholders) for the current language. */
export function useEditorDictionary(): Dictionary {
  return DICTIONARIES[useLocale()] ?? en;
}

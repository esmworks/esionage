import type { PropertyType } from "@/db/schema/app";
import { DEFAULT_LOCALE, isLocale } from "@/i18n/config";
import { loadLocaleFile, withFallback } from "@/i18n/messages";
import source from "@/i18n/messages/en/templates.json";

/**
 * The built-in template gallery: a few starting points every workspace can use. They live here as
 * Markdown and plain data, not in the database; picking one creates an ordinary page (see
 * server/templates.ts `createFromBuiltin`). Each comes in every UI language: the structure (kinds,
 * icons, property types, which option each example row has) is below, the texts are in
 * `i18n/messages/<locale>/templates.json`.
 */

export const BUILTIN_TEMPLATE_KEYS = ["meeting-notes", "weekly-plan", "project-tracker"] as const;
export type BuiltinTemplateKey = (typeof BUILTIN_TEMPLATE_KEYS)[number];

export const isBuiltinTemplateKey = (value: unknown): value is BuiltinTemplateKey =>
  typeof value === "string" && (BUILTIN_TEMPLATE_KEYS as readonly string[]).includes(value);

type Common = { key: BuiltinTemplateKey; icon: string; title: string; description: string };

export type BuiltinPageTemplate = Common & { kind: "page"; markdown: string };

export type BuiltinProperty = { name: string; type: PropertyType; options?: string[] };

export type BuiltinDatabaseTemplate = Common & {
  kind: "database";
  /** Names of the starter properties every new database gets (see pages.DatabaseSeedNames). */
  seedNames: { status: string; notStarted: string; inProgress: string; done: string; tags: string; table: string };
  /** Added after the starter ones. */
  properties: BuiltinProperty[];
  /** A board grouped by the starter status property. */
  board: string;
  /** Becomes the database's default row template. Values are keyed by property name. */
  rowTemplate: { title: string; markdown: string; properties: Record<string, unknown> };
  /** A few example rows. */
  rows: { title: string; properties: Record<string, unknown> }[];
};

export type BuiltinTemplate = BuiltinPageTemplate | BuiltinDatabaseTemplate;

type Texts = typeof source;
type TrackerTexts = Texts["project-tracker"];
type Status = "notStarted" | "inProgress" | "done";
type Priority = keyof TrackerTexts["options"];

const TRACKER_ROWS: { key: keyof TrackerTexts["rows"]; status: Status; priority: Priority }[] = [
  { key: "brief", status: "done", priority: "high" },
  { key: "milestone", status: "inProgress", priority: "high" },
  { key: "team", status: "notStarted", priority: "medium" },
];

function build(texts: Texts): BuiltinTemplate[] {
  const tracker = texts["project-tracker"];
  const { seedNames, properties: names, options } = tracker;
  const values = (status: Status, priority: Priority) => ({
    [seedNames.status]: seedNames[status],
    [names.priority]: options[priority],
  });
  return [
    { key: "meeting-notes", kind: "page", icon: "📝", ...texts["meeting-notes"] },
    { key: "weekly-plan", kind: "page", icon: "🗓️", ...texts["weekly-plan"] },
    {
      key: "project-tracker",
      kind: "database",
      icon: "📋",
      title: tracker.title,
      description: tracker.description,
      seedNames,
      properties: [
        { name: names.priority, type: "select", options: [options.high, options.medium, options.low] },
        { name: names.owner, type: "person" },
        { name: names.due, type: "date" },
      ],
      board: tracker.board,
      rowTemplate: { ...tracker.rowTemplate, properties: values("notStarted", "medium") },
      rows: TRACKER_ROWS.map((row) => ({ title: tracker.rows[row.key], properties: values(row.status, row.priority) })),
    },
  ];
}

/** The gallery in the given UI language; English for any other, and for texts a language lacks. */
export async function builtinTemplates(locale: string | undefined): Promise<BuiltinTemplate[]> {
  if (!isLocale(locale) || locale === DEFAULT_LOCALE) return build(source);
  return build(withFallback(source, await loadLocaleFile(locale, "templates")));
}

export async function builtinTemplate(key: BuiltinTemplateKey, locale: string | undefined): Promise<BuiltinTemplate> {
  return (await builtinTemplates(locale)).find((t) => t.key === key)!;
}

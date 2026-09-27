import type { PropertyType } from "@/db/schema/app";

/**
 * The built-in template gallery: a few starting points every workspace can use. They live here as
 * Markdown and plain data, not in the database; picking one creates an ordinary page (see
 * server/templates.ts `createFromBuiltin`). Each comes in every UI language.
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

type Locale = "en" | "tr";

const EN: BuiltinTemplate[] = [
  {
    key: "meeting-notes",
    kind: "page",
    icon: "📝",
    title: "Meeting notes",
    description: "Agenda, notes, decisions and action items.",
    markdown: `**Date:** \n\n**Attendees:** \n\n## Agenda\n\n1. \n\n## Notes\n\n\n\n## Decisions\n\n- \n\n## Action items\n\n- [ ] `,
  },
  {
    key: "weekly-plan",
    kind: "page",
    icon: "🗓️",
    title: "Weekly plan",
    description: "Goals for the week and a checklist per day.",
    markdown: [
      "## Goals this week",
      "",
      "- [ ] ",
      "",
      ...["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"].flatMap((day) => [`### ${day}`, "", "- [ ] ", ""]),
      "## Notes for next week",
      "",
    ].join("\n"),
  },
  {
    key: "project-tracker",
    kind: "database",
    icon: "📋",
    title: "Project tracker",
    description: "Tasks with status, priority, owner and due date, on a table and a board.",
    seedNames: { status: "Status", notStarted: "Not started", inProgress: "In progress", done: "Done", tags: "Tags", table: "All tasks" },
    properties: [
      { name: "Priority", type: "select", options: ["High", "Medium", "Low"] },
      { name: "Owner", type: "person" },
      { name: "Due", type: "date" },
    ],
    board: "Board",
    rowTemplate: {
      title: "New task",
      markdown: "## Goal\n\n\n\n## Steps\n\n- [ ] \n\n## Notes\n\n",
      properties: { Status: "Not started", Priority: "Medium" },
    },
    rows: [
      { title: "Write the project brief", properties: { Status: "Done", Priority: "High" } },
      { title: "Plan the first milestone", properties: { Status: "In progress", Priority: "High" } },
      { title: "Invite the team", properties: { Status: "Not started", Priority: "Medium" } },
    ],
  },
];

const TR: BuiltinTemplate[] = [
  {
    key: "meeting-notes",
    kind: "page",
    icon: "📝",
    title: "Toplantı notları",
    description: "Gündem, notlar, kararlar ve yapılacaklar.",
    markdown: `**Tarih:** \n\n**Katılımcılar:** \n\n## Gündem\n\n1. \n\n## Notlar\n\n\n\n## Kararlar\n\n- \n\n## Yapılacaklar\n\n- [ ] `,
  },
  {
    key: "weekly-plan",
    kind: "page",
    icon: "🗓️",
    title: "Haftalık plan",
    description: "Haftanın hedefleri ve her gün için bir yapılacaklar listesi.",
    markdown: [
      "## Bu haftanın hedefleri",
      "",
      "- [ ] ",
      "",
      ...["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma"].flatMap((day) => [`### ${day}`, "", "- [ ] ", ""]),
      "## Gelecek hafta için notlar",
      "",
    ].join("\n"),
  },
  {
    key: "project-tracker",
    kind: "database",
    icon: "📋",
    title: "Proje takibi",
    description: "Durumu, önceliği, sorumlusu ve bitiş tarihi olan görevler; tablo ve pano görünümüyle.",
    seedNames: {
      status: "Durum",
      notStarted: "Başlamadı",
      inProgress: "Devam ediyor",
      done: "Tamamlandı",
      tags: "Etiketler",
      table: "Tüm görevler",
    },
    properties: [
      { name: "Öncelik", type: "select", options: ["Yüksek", "Orta", "Düşük"] },
      { name: "Sorumlu", type: "person" },
      { name: "Bitiş", type: "date" },
    ],
    board: "Pano",
    rowTemplate: {
      title: "Yeni görev",
      markdown: "## Amaç\n\n\n\n## Adımlar\n\n- [ ] \n\n## Notlar\n\n",
      properties: { Durum: "Başlamadı", Öncelik: "Orta" },
    },
    rows: [
      { title: "Proje özetini yaz", properties: { Durum: "Tamamlandı", Öncelik: "Yüksek" } },
      { title: "İlk kilometre taşını planla", properties: { Durum: "Devam ediyor", Öncelik: "Yüksek" } },
      { title: "Ekibi davet et", properties: { Durum: "Başlamadı", Öncelik: "Orta" } },
    ],
  },
];

const BY_LOCALE: Record<Locale, BuiltinTemplate[]> = { en: EN, tr: TR };

/** The gallery in the given UI language, English for any other. */
export function builtinTemplates(locale: string | undefined): BuiltinTemplate[] {
  return BY_LOCALE[(locale === "tr" ? "tr" : "en") as Locale];
}

export function builtinTemplate(key: BuiltinTemplateKey, locale: string | undefined): BuiltinTemplate {
  return builtinTemplates(locale).find((t) => t.key === key)!;
}

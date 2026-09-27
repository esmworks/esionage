import { describe, expect, it } from "vitest";
import { LOCALES } from "@/i18n/config";
import { BUILTIN_TEMPLATE_KEYS, builtinTemplates, type BuiltinDatabaseTemplate } from "./builtin-templates";

describe("built-in templates", () => {
  it.each(LOCALES)("%s: every template, with rows that use its own property and option names", async (locale) => {
    const templates = await builtinTemplates(locale);
    expect(templates.map((t) => t.key)).toEqual([...BUILTIN_TEMPLATE_KEYS]);
    const tracker = templates.find((t): t is BuiltinDatabaseTemplate => t.kind === "database")!;
    const { seedNames, properties } = tracker;
    const options = new Map<string, string[]>([
      [seedNames.status, [seedNames.notStarted, seedNames.inProgress, seedNames.done]],
      ...properties.filter((p) => p.options).map((p): [string, string[]] => [p.name, p.options!]),
    ]);
    // Distinct names, or rows would set the wrong property.
    expect(new Set([...options.keys(), seedNames.tags, ...properties.map((p) => p.name)]).size).toBe(2 + properties.length);
    for (const row of [tracker.rowTemplate, ...tracker.rows]) {
      expect(row.title.trim()).not.toBe("");
      for (const [name, value] of Object.entries(row.properties)) expect(options.get(name), `${locale}: ${name}`).toContain(value);
    }
  });

  it("uses English for unknown languages", async () => {
    expect((await builtinTemplates("xx"))[0].title).toBe("Meeting notes");
    expect((await builtinTemplates("tr"))[0].title).toBe("Toplantı notları");
  });
});

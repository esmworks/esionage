import { describe, expect, it } from "vitest";
import { chunkPage, rowPropertyLines } from "./semantic-text";

/**
 * Property access and the semantic index: the index is shared by every reader, so values of
 * properties with access rules never go into it (semantic-index restrictedProperties), and a rule
 * change drops exactly the chunks that can hold row values (semantic-index reindexDatabaseRows).
 */
const props = [
  { id: "t", name: "Notes", type: "text", options: {} },
  { id: "salary", name: "Salary", type: "number", options: {} },
  { id: "e", name: "Email", type: "email", options: {} },
] as never[];
const values = { t: "Hired in May", salary: 98_765, e: "ada@example.com" };

const para = (id: string, text: string) => ({ id, text });

describe("row values in the semantic index under property access", () => {
  it("leaves out restricted properties, name and value", () => {
    const lines = rowPropertyLines(props, values, new Set(["salary"]));
    expect(lines).toEqual(["Notes: Hired in May", "Email: ada@example.com"]);
    expect(lines.join("\n")).not.toMatch(/Salary|98/);
  });

  it("keeps every value without restrictions", () => {
    expect(rowPropertyLines(props, values)).toHaveLength(3);
    expect(rowPropertyLines(props, values, new Set())).toHaveLength(3);
  });

  it("leaves out everything when every property is restricted", () => {
    expect(rowPropertyLines(props, values, new Set(["t", "salary", "e"]))).toEqual([]);
  });

  it("only ever puts row values in chunks without a block (what a rule change drops)", () => {
    const secret = "Salary: 98765";
    const cases = [
      // Values and a short block share one chunk.
      { title: "Ada", properties: [secret], blocks: [para("b1", "Short note.")] },
      // Values longer than a chunk: several chunks, then blocks.
      {
        title: "Ada",
        properties: [secret, ...Array.from({ length: 40 }, (_, i) => `Field ${i}: ${"word ".repeat(20)}`)],
        blocks: [para("b1", "x ".repeat(500)), para("b2", "Closing words.")],
      },
      // Values alone.
      { title: "Ada", properties: [secret], blocks: [] },
    ];
    for (const source of cases) {
      const chunks = chunkPage(source, { target: 300, max: 400 });
      const withValues = chunks.filter((c) => source.properties.some((line) => c.text.includes(line)));
      expect(withValues.length).toBeGreaterThan(0);
      for (const chunk of withValues) expect(chunk.blockId).toBeNull();
    }
  });

  it("has no values in any chunk once they are left out", () => {
    const lines = rowPropertyLines(props, values, new Set(["salary"]));
    const chunks = chunkPage({ title: "Ada", properties: lines, blocks: [para("b1", "Body text.")] });
    expect(chunks.some((c) => c.text.includes("98765") || c.text.includes("Salary"))).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import type { PropertyOptions, PropertyType } from "@/db/schema/app";
import {
  applyView,
  displayValue,
  filterNeedsValue,
  filterOperators,
  groupRows,
  normalizeValue,
  positionBetween,
  PropertyValueError,
  type RowLike,
} from "./properties";

const prop = (type: PropertyType, options: PropertyOptions = {}) => ({ id: `p_${type}`, name: type, type, options });

const status = prop("select", {
  options: [
    { id: "o1", name: "Not started", color: "gray" },
    { id: "o2", name: "In progress", color: "blue" },
    { id: "o3", name: "Done", color: "green" },
  ],
});
const tags = prop("multi_select", {
  options: [
    { id: "t1", name: "Bug", color: "red" },
    { id: "t2", name: "UI", color: "purple" },
  ],
});

describe("normalizeValue", () => {
  it("clears on empty input", () => {
    expect(normalizeValue(prop("text"), "")).toBeNull();
    expect(normalizeValue(prop("number"), null)).toBeNull();
    expect(normalizeValue(prop("select"), undefined)).toBeNull();
  });

  it("parses numbers including comma decimals", () => {
    expect(normalizeValue(prop("number"), "3,5")).toBe(3.5);
    expect(normalizeValue(prop("number"), 7)).toBe(7);
    expect(() => normalizeValue(prop("number"), "abc")).toThrow(PropertyValueError);
  });

  it("validates urls", () => {
    expect(normalizeValue(prop("url"), " https://example.com ")).toBe("https://example.com");
    expect(normalizeValue(prop("url"), "mailto:a@b.co")).toBe("mailto:a@b.co");
    expect(() => normalizeValue(prop("url"), "example.com")).toThrow(PropertyValueError);
  });

  it("accepts booleans and their string forms for checkboxes", () => {
    expect(normalizeValue(prop("checkbox"), true)).toBe(true);
    expect(normalizeValue(prop("checkbox"), "false")).toBe(false);
    expect(() => normalizeValue(prop("checkbox"), "yes")).toThrow(PropertyValueError);
  });

  it("truncates ISO dates to the day", () => {
    expect(normalizeValue(prop("date"), "2026-09-26T10:00:00Z")).toBe("2026-09-26");
    expect(() => normalizeValue(prop("date"), "26/09/2026")).toThrow(PropertyValueError);
  });

  it("resolves select values by id or case-insensitive name", () => {
    expect(normalizeValue(status, "o2")).toBe("o2");
    expect(normalizeValue(status, "done")).toBe("o3");
    expect(() => normalizeValue(status, "Blocked")).toThrow(PropertyValueError);
    expect(normalizeValue(tags, ["Bug", "t2"])).toEqual(["t1", "t2"]);
    expect(normalizeValue(tags, "ui")).toEqual(["t2"]);
  });
});

describe("displayValue", () => {
  it("maps option ids to names", () => {
    expect(displayValue(status, "o3")).toBe("Done");
    expect(displayValue(tags, ["t1", "missing", "t2"])).toEqual(["Bug", "UI"]);
    expect(displayValue(prop("number"), 4)).toBe(4);
    expect(displayValue(status, null)).toBeNull();
  });
});

const row = (id: string, title: string, properties: Record<string, unknown> = {}, day = 1): RowLike => ({
  id,
  title,
  properties,
  createdAt: new Date(Date.UTC(2026, 0, day)),
  updatedAt: new Date(Date.UTC(2026, 0, day)),
});

describe("applyView", () => {
  const rows = [
    row("a", "Alpha", { p_number: 3, p_select: "o3", p_checkbox: true, p_multi_select: ["t1"] }, 1),
    row("b", "beta", { p_number: 10, p_select: "o1", p_checkbox: false }, 2),
    row("c", "Gamma", { p_select: "o2", p_multi_select: ["t1", "t2"] }, 3),
    row("d", "", {}, 4),
  ];
  const props = [prop("number"), status, prop("checkbox"), tags];

  it("filters by title contains, case-insensitively", () => {
    const out = applyView(rows, { filters: [{ propertyId: "title", op: "contains", value: "A" }] });
    expect(out.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("filters numbers with gt/lt", () => {
    expect(applyView(rows, { filters: [{ propertyId: "p_number", op: "gt", value: 5 }] }).map((r) => r.id)).toEqual(["b"]);
    expect(applyView(rows, { filters: [{ propertyId: "p_number", op: "lt", value: "5" }] }).map((r) => r.id)).toEqual(["a"]);
  });

  it("treats unchecked and untouched checkboxes as empty", () => {
    const unchecked = applyView(rows, { filters: [{ propertyId: "p_checkbox", op: "is_empty" }] });
    expect(unchecked.map((r) => r.id)).toEqual(["b", "c", "d"]);
    const checked = applyView(rows, { filters: [{ propertyId: "p_checkbox", op: "is_not_empty" }] });
    expect(checked.map((r) => r.id)).toEqual(["a"]);
  });

  it("matches multi-select contains / does not contain by option id", () => {
    const has = applyView(rows, { filters: [{ propertyId: "p_multi_select", op: "contains", value: "t2" }] });
    expect(has.map((r) => r.id)).toEqual(["c"]);
    const not = applyView(rows, { filters: [{ propertyId: "p_multi_select", op: "not_equals", value: "t1" }] });
    expect(not.map((r) => r.id)).toEqual(["b", "d"]);
  });

  it("combines filters with AND", () => {
    const out = applyView(rows, {
      filters: [
        { propertyId: "title", op: "is_not_empty" },
        { propertyId: "p_select", op: "not_equals", value: "o1" },
      ],
    });
    expect(out.map((r) => r.id)).toEqual(["a", "c"]);
  });

  it("sorts selects by option order and keeps empties last in both directions", () => {
    const asc = applyView(rows, { sorts: [{ propertyId: "p_select", direction: "asc" }] }, props);
    expect(asc.map((r) => r.id)).toEqual(["b", "c", "a", "d"]);
    const desc = applyView(rows, { sorts: [{ propertyId: "p_select", direction: "desc" }] }, props);
    expect(desc.map((r) => r.id)).toEqual(["a", "c", "b", "d"]);
  });

  it("sorts titles naturally and by creation time", () => {
    const byTitle = applyView(rows, { sorts: [{ propertyId: "title", direction: "asc" }] });
    expect(byTitle.map((r) => r.id)).toEqual(["a", "b", "c", "d"]);
    const newest = applyView(rows, { sorts: [{ propertyId: "created_at", direction: "desc" }] });
    expect(newest.map((r) => r.id)).toEqual(["d", "c", "b", "a"]);
  });

  it("does not mutate the input", () => {
    const copy = [...rows];
    applyView(rows, { sorts: [{ propertyId: "title", direction: "desc" }] });
    expect(rows).toEqual(copy);
  });
});

describe("filterOperators", () => {
  it("offers type-appropriate operators", () => {
    expect(filterOperators("checkbox").map((o) => o.op)).toEqual(["is_not_empty", "is_empty"]);
    expect(filterOperators("number").map((o) => o.op)).toContain("gt");
    expect(filterOperators("select").map((o) => o.op)).not.toContain("contains");
    expect(filterOperators("title")[0].op).toBe("contains");
  });

  it("knows which operators need a value", () => {
    expect(filterNeedsValue("contains")).toBe(true);
    expect(filterNeedsValue("is_empty")).toBe(false);
    expect(filterNeedsValue("is_not_empty")).toBe(false);
  });
});

describe("positionBetween", () => {
  it("returns a value strictly between neighbours", () => {
    expect(positionBetween(1, 2)).toBe(1.5);
    expect(positionBetween(5, null)).toBe(6);
    expect(positionBetween(undefined, 3)).toBe(2);
    expect(positionBetween()).toBe(1);
  });
});

describe("groupRows", () => {
  it("buckets by option order with an empty group first, preserving row order", () => {
    const rows = [
      row("a", "A", { p_select: "o3" }),
      row("b", "B", {}),
      row("c", "C", { p_select: "o1" }),
      row("d", "D", { p_select: "o3" }),
      row("e", "E", { p_select: "deleted-option" }),
    ];
    const groups = groupRows(rows, status);
    expect(groups.map((g) => g.option?.name ?? null)).toEqual([null, "Not started", "In progress", "Done"]);
    expect(groups.map((g) => g.rows.map((r) => r.id))).toEqual([["b", "e"], ["c"], [], ["a", "d"]]);
  });
});

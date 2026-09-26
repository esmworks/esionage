import { describe, expect, it } from "vitest";
import { applyView, PropertyValueError, type RowLike } from "@/lib/properties";
import {
  describeProperty,
  describeViewConfig,
  displayProperties,
  resolvePropertyKey,
  toFilterRule,
  toSortRule,
  type PropertyDef,
} from "./query";

const props: PropertyDef[] = [
  {
    id: "p_status",
    name: "Status",
    type: "select",
    options: {
      options: [
        { id: "o_todo", name: "Not started", color: "gray" },
        { id: "o_done", name: "Done", color: "green" },
      ],
    },
  },
  {
    id: "p_tags",
    name: "Tags",
    type: "multi_select",
    options: { options: [{ id: "o_urgent", name: "Urgent", color: "red" }] },
  },
  { id: "p_est", name: "Estimate", type: "number", options: {} },
  { id: "p_ok", name: "Approved", type: "checkbox", options: {} },
];

const row = (id: string, properties: Record<string, unknown>): RowLike => ({
  id,
  title: id,
  properties,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-02"),
});

describe("resolvePropertyKey", () => {
  it("matches ids, case-insensitive names and special keys", () => {
    expect(resolvePropertyKey(props, "p_est").key).toBe("p_est");
    expect(resolvePropertyKey(props, " status ").key).toBe("p_status");
    expect(resolvePropertyKey(props, "Title").key).toBe("title");
    expect(resolvePropertyKey(props, "created_at").key).toBe("created_at");
  });

  it("lists the available properties when the name is unknown", () => {
    expect(() => resolvePropertyKey(props, "Colour")).toThrowError(/Unknown property "Colour".*Status \(select\)/);
  });
});

describe("toFilterRule", () => {
  it("resolves select option names to ids", () => {
    expect(toFilterRule(props, { property: "Status", op: "equals", value: "done" })).toEqual({
      propertyId: "p_status",
      op: "equals",
      value: "o_done",
    });
    expect(toFilterRule(props, { property: "tags", op: "contains", value: "Urgent" }).value).toBe("o_urgent");
  });

  it("rejects unknown options with the option list", () => {
    expect(() => toFilterRule(props, { property: "Status", op: "equals", value: "Blocked" })).toThrowError(
      /Options: Not started, Done/,
    );
  });

  it("requires a value only for comparison ops", () => {
    expect(toFilterRule(props, { property: "Status", op: "is_empty" })).toEqual({ propertyId: "p_status", op: "is_empty" });
    expect(() => toFilterRule(props, { property: "Estimate", op: "gt" })).toThrow(PropertyValueError);
  });

  it("coerces checkbox and number values", () => {
    expect(toFilterRule(props, { property: "Approved", op: "equals", value: "true" }).value).toBe(true);
    expect(toFilterRule(props, { property: "Estimate", op: "gt", value: "5" }).value).toBe(5);
    expect(() => toFilterRule(props, { property: "Estimate", op: "lt", value: "many" })).toThrow(PropertyValueError);
  });

  it("refuses ordering ops on selects", () => {
    expect(() => toFilterRule(props, { property: "Status", op: "gt", value: "Done" })).toThrow(PropertyValueError);
  });

  it("produces rules that applyView understands", () => {
    const rows = [
      row("a", { p_status: "o_todo", p_est: 3, p_tags: ["o_urgent"] }),
      row("b", { p_status: "o_done", p_est: 8 }),
    ];
    const done = applyView(rows, { filters: [toFilterRule(props, { property: "Status", op: "equals", value: "Done" })] }, props);
    expect(done.map((r) => r.id)).toEqual(["b"]);
    const urgent = applyView(rows, { filters: [toFilterRule(props, { property: "Tags", op: "contains", value: "urgent" })] }, props);
    expect(urgent.map((r) => r.id)).toEqual(["a"]);
    const sorted = applyView(rows, { sorts: [toSortRule(props, { property: "estimate", direction: "desc" })] }, props);
    expect(sorted.map((r) => r.id)).toEqual(["b", "a"]);
  });
});

describe("display helpers", () => {
  it("keys values by name, shows option names and drops empties", () => {
    expect(displayProperties(props, { p_status: "o_done", p_tags: [], p_est: 0, p_ok: false })).toEqual({
      Status: "Done",
      Estimate: 0,
      Approved: false,
    });
  });

  it("describes view configs with names", () => {
    expect(
      describeViewConfig(props, {
        groupBy: "p_status",
        filters: [{ propertyId: "p_status", op: "equals", value: "o_done" }],
        sorts: [{ propertyId: "title", direction: "asc" }],
      }),
    ).toEqual({
      group_by: "Status",
      filters: [{ property: "Status", op: "equals", value: "Done" }],
      sorts: [{ property: "title", direction: "asc" }],
    });
  });
});

describe("relations", () => {
  const customer: PropertyDef = {
    id: "p_customer",
    name: "Customer",
    type: "relation",
    options: { relation: { databaseId: "db-customers", pairedPropertyId: "p_jobs" } },
  };
  const all = [...props, customer];
  const targets = {
    p_customer: {
      database: { id: "db-customers", title: "Customers" },
      pairedName: "Jobs",
      rows: [
        { id: "c1", title: "Acme" },
        { id: "c2", title: "Globex" },
        { id: "c3", title: "Globex" },
      ],
    },
  };

  it("filters by related row id or unique title", () => {
    expect(toFilterRule(all, { property: "customer", op: "contains", value: "acme" }, targets)).toEqual({
      propertyId: "p_customer",
      op: "contains",
      value: "c1",
    });
    expect(toFilterRule(all, { property: "Customer", op: "not_equals", value: "c3" }, targets).value).toBe("c3");
    expect(() => toFilterRule(all, { property: "Customer", op: "contains", value: "Globex" }, targets)).toThrow(/2 rows/);
    expect(() => toFilterRule(all, { property: "Customer", op: "contains", value: "Nope" }, targets)).toThrow(/not a row/);
    expect(() => toFilterRule(all, { property: "Customer", op: "gt", value: "c1" }, targets)).toThrow(/supports contains/);
  });

  it("is not sortable", () => {
    expect(() => toSortRule(all, { property: "Customer" })).toThrow(/can't be sorted/);
  });

  it("shows linked rows as id and title, skipping rows that no longer exist", () => {
    expect(displayProperties(all, { p_customer: ["c2", "gone", "c1"] }, targets)).toEqual({
      Customer: [
        { id: "c2", title: "Globex" },
        { id: "c1", title: "Acme" },
      ],
    });
    expect(displayProperties(all, { p_customer: ["gone"] }, targets)).toEqual({});
  });

  it("describes the related database, pairing and calendar date property", () => {
    expect(describeProperty(customer, targets)).toMatchObject({
      type: "relation",
      related_database_id: "db-customers",
      related_database: "Customers",
      two_way: true,
      paired_property: "Jobs",
    });
    expect(
      describeViewConfig(all, { dateBy: "p_est", filters: [{ propertyId: "p_customer", op: "contains", value: "c1" }] }, targets),
    ).toEqual({ date_by: "Estimate", filters: [{ property: "Customer", op: "contains", value: "Acme" }] });
  });
});

import { describe, expect, it, vi } from "vitest";
import { makeAccess } from "@/lib/property-access-rows";
import type { PropertyRule, PropertyViewer } from "@/lib/property-access";
import { visibleFileIds } from "./export";
import { importableProperties } from "./import/csv";

// What exports and CSV imports make of property access (see server/property-access): pure parts.

vi.mock("@/db", () => ({ db: {} }));

const file = (n: number) => `F${String(n).padStart(23, "0")}`;
const path = (n: number) => `/api/files/${file(n)}`;

const props = [
  { id: "photos", name: "Photos", type: "files" as const, options: {} },
  { id: "contract", name: "Contract", type: "files" as const, options: {} },
  { id: "notes", name: "Notes", type: "text" as const, options: {} },
  { id: "owner", name: "Owner", type: "person" as const, options: {} },
  { id: "total", name: "Total", type: "formula" as const, options: { formula: { expression: "1" } } },
];
const rule = (propertyId: string, level: PropertyRule["level"], extra: Partial<PropertyRule> = {}): PropertyRule => ({
  propertyId,
  userId: null,
  groupId: null,
  personPropertyId: null,
  level,
  ...extra,
});
const viewer = (databaseLevel: PropertyViewer["databaseLevel"] = "edit"): PropertyViewer => ({ userId: "me", groupIds: [], databaseLevel });

describe("visibleFileIds", () => {
  const rules = new Map([
    ["photos", [rule("photos", "view_property")]],
    ["contract", [rule("contract", "none"), rule("contract", "view", { personPropertyId: "owner" })]],
  ]);
  const row = (properties: Record<string, unknown>, contentMarkdown = "") => ({ properties, createdBy: "someone", contentMarkdown });

  it("keeps files of the body and of values the exporter may see, not of hidden values", () => {
    const access = makeAccess(rules, viewer(), props);
    const ids = visibleFileIds(
      row(
        { photos: [{ url: path(1), name: "a.png" }], contract: [{ url: path(2), name: "c.pdf" }], notes: "x" },
        `![](${path(3)})`,
      ),
      access,
    );
    expect([...ids].sort()).toEqual([file(3)]);
  });

  it("keeps a hidden value's file when the body shows it too", () => {
    const access = makeAccess(rules, viewer(), props);
    const ids = visibleFileIds(row({ photos: [{ url: path(1), name: "a.png" }] }, `[a.png](${path(1)})`), access);
    expect([...ids]).toEqual([file(1)]);
  });

  it("follows rows that name the exporter in a person property", () => {
    const access = makeAccess(rules, viewer(), props);
    const mine = visibleFileIds(row({ owner: ["me"], contract: [{ url: path(2), name: "c.pdf" }] }), access);
    expect([...mine]).toEqual([file(2)]);
  });

  it("keeps everything for someone with full access", () => {
    const access = makeAccess(rules, viewer("full"), props);
    const ids = visibleFileIds(row({ photos: [{ url: path(1), name: "a.png" }], contract: [{ url: path(2), name: "c.pdf" }] }), access);
    expect([...ids].sort()).toEqual([file(1), file(2)]);
  });
});

describe("importableProperties", () => {
  it("offers only properties whose values the importer may set in a new row", () => {
    const rules = new Map([
      ["photos", [rule("photos", "edit")]],
      ["notes", [rule("notes", "view")]],
      ["contract", [rule("contract", "none")]],
      ["owner", [rule("owner", "edit_values")]],
    ]);
    const access = makeAccess(rules, viewer(), props);
    // Files and formulas are never imported; Contract can't be known of; Notes is read-only.
    expect(importableProperties(props, access).map((p) => p.id)).toEqual(["owner"]);
  });

  it("offers every importable property without rules, or a person property exception alone", () => {
    const open = makeAccess(new Map(), viewer(), props);
    expect(importableProperties(props, open).map((p) => p.id)).toEqual(["notes", "owner"]);
    // Rows the importer is named in may give edit_values, but a new row names nobody yet.
    const perRow = makeAccess(new Map([["notes", [rule("notes", "view"), rule("notes", "edit_values", { personPropertyId: "owner" })]]]), viewer(), props);
    expect(importableProperties(props, perRow).map((p) => p.id)).toEqual(["owner"]);
  });

  it("offers nothing to someone who may only view the database", () => {
    const access = makeAccess(new Map([["photos", [rule("photos", "view")]]]), viewer("view"), props);
    expect(importableProperties(props, access)).toEqual([]);
  });
});

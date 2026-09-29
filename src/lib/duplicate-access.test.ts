import { describe, expect, it } from "vitest";
import { copyAccess, planDuplicate, planPropertyRules, redactCopy, type DuplicateInput, type SourceRule } from "./duplicate";
import { writableProperties } from "./forms";
import type { PropertyRule, PropertyViewer } from "./property-access";
import { makeAccess } from "./property-access-rows";
import type { PropertyType } from "./property-types";
import { unknownToVisitors } from "./published-copy";

// A database "db" with: salary (hidden for everyone, owner may view), secret (unknown to everyone),
// notes (read-only for everyone, editable in rows that name you as owner), owner (a person
// property) and title-free plain values in "plain".
const prop = (id: string, type: PropertyType = "text") => ({ id, name: id, type, options: {} });
const properties = [prop("salary", "number"), prop("secret"), prop("notes"), prop("owner", "person"), prop("plain")];
const rule = (propertyId: string, level: PropertyRule["level"], who: Partial<PropertyRule> = {}): PropertyRule => ({
  propertyId,
  userId: null,
  groupId: null,
  personPropertyId: null,
  level,
  ...who,
});
const rules = new Map<string, PropertyRule[]>([
  ["salary", [rule("salary", "view_property"), rule("salary", "view", { userId: "boss" })]],
  ["secret", [rule("secret", "none")]],
  ["notes", [rule("notes", "view"), rule("notes", "edit_values", { personPropertyId: "owner" })]],
]);
const viewer = (userId: string, databaseLevel: PropertyViewer["databaseLevel"] = "edit"): PropertyViewer => ({
  userId,
  groupIds: [],
  databaseLevel,
});
const accessOf = (userId: string, level: PropertyViewer["databaseLevel"] = "edit") => makeAccess(rules, viewer(userId, level), properties);
const values = { salary: 100, secret: "x", notes: "n", owner: ["u1"], plain: "p" };

describe("copyAccess", () => {
  it("carries everything for someone with full access", () => {
    expect(copyAccess(accessOf("u1", "full"), properties)).toBeNull();
  });

  it("drops properties the copier can't know of and values they can't view", () => {
    const carried = copyAccess(accessOf("u1"), properties)!;
    expect([...carried.gone]).toEqual(["secret"]);
    expect(carried.values({ properties: values })).toEqual({ notes: "n", owner: ["u1"], plain: "p" });
    expect(copyAccess(accessOf("boss"), properties)!.values({ properties: values })).toEqual({
      salary: 100,
      notes: "n",
      owner: ["u1"],
      plain: "p",
    });
  });

  it("keeps only what the copier could set when the row lands in the same database", () => {
    const carried = copyAccess(accessOf("u1"), properties, { write: { createdBy: "u1" } })!;
    // notes is editable only because the row names them as owner.
    expect(carried.values({ properties: values })).toEqual({ notes: "n", owner: ["u1"], plain: "p" });
    expect(carried.values({ properties: { ...values, owner: ["u2"] } })).toEqual({ owner: ["u2"], plain: "p" });
    // The boss may view salary, not change it.
    expect(copyAccess(accessOf("boss"), properties, { write: { createdBy: "boss" } })!.values({ properties: values })).toEqual({
      owner: ["u1"],
      plain: "p",
    });
  });

  it("takes extra properties to leave out", () => {
    const carried = copyAccess(accessOf("u1", "full"), properties, { gone: new Set(["plain"]) })!;
    expect(carried.values({ properties: values })).toEqual({ salary: 100, secret: "x", notes: "n", owner: ["u1"] });
  });
});

describe("redactCopy and planPropertyRules", () => {
  const input: DuplicateInput = {
    rootId: "root",
    rootTitle: "Root",
    rootPosition: 1,
    pages: [
      { id: "root", parentId: "parent", kind: "page", title: "Root", position: 1, properties: {} },
      { id: "db", parentId: "root", kind: "database", title: "DB", position: 1, properties: {} },
      { id: "r1", parentId: "db", kind: "page", title: "r1", position: 1, properties: values },
    ],
    properties: properties.map((p, i) => ({ ...p, databaseId: "db", position: i })),
    views: [
      {
        id: "v",
        databaseId: "db",
        name: "Table",
        type: "table",
        position: 1,
        config: {
          groupBy: "secret",
          sorts: [
            { propertyId: "secret", direction: "asc" },
            { propertyId: "plain", direction: "asc" },
          ],
          filters: [
            { type: "group", combinator: "or", rules: [{ propertyId: "secret", op: "is_empty" }, { propertyId: "plain", op: "is_empty" }] },
            { propertyId: "salary", op: "is_not_empty" },
          ],
          hidden: ["secret", "plain"],
        } as never,
      },
    ],
  };

  it("leaves the copier's unknown properties out of the schema, rows and views", () => {
    const redacted = redactCopy(input, new Map([["db", copyAccess(accessOf("u1"), properties)!]]));
    expect(redacted.properties.map((p) => p.id)).toEqual(["salary", "notes", "owner", "plain"]);
    expect(redacted.pages.find((p) => p.id === "r1")!.properties).toEqual({ notes: "n", owner: ["u1"], plain: "p" });
    const config = redacted.views[0].config;
    expect(config.groupBy).toBeUndefined();
    expect(config.sorts).toEqual([{ propertyId: "plain", direction: "asc" }]);
    // A filter group mentioning it goes whole, as the copier saw the view.
    expect(config.filters).toEqual([{ propertyId: "salary", op: "is_not_empty" }]);
    expect(config.hidden).toEqual(["plain"]);
    // Nothing changes without restrictions.
    expect(redactCopy(input, new Map())).toBe(input);
  });

  it("leaves behind the form defaults of values the copier can't see", () => {
    const withForm = {
      ...input,
      views: [{ ...input.views[0], config: { ...input.views[0].config, form: { defaults: { salary: 5, notes: "n", plain: "p" } } } as never }],
    };
    const redacted = redactCopy(withForm, new Map([["db", copyAccess(accessOf("u1"), properties)!]]));
    expect(redacted.views[0].config.form?.defaults).toEqual({ notes: "n", plain: "p" });
    const boss = redactCopy(withForm, new Map([["db", copyAccess(accessOf("boss"), properties)!]]));
    expect(boss.views[0].config.form?.defaults).toEqual({ salary: 5, notes: "n", plain: "p" });
  });

  it("points the rules of surviving properties at the copies, person exceptions included", () => {
    const redacted = redactCopy(input, new Map([["db", copyAccess(accessOf("u1"), properties)!]]));
    let n = 0;
    const plan = planDuplicate(redacted, () => `new${++n}`);
    const source: SourceRule[] = [...rules.values()].flat().map((r) => ({ ...r, databaseId: "db" }));
    const copied = planPropertyRules(source, plan);
    const newDb = plan.pageIds.get("db")!;
    const ids = plan.propertyIds;
    expect(copied).toEqual([
      { ...source[0], propertyId: ids.get("salary"), databaseId: newDb },
      { ...source[1], propertyId: ids.get("salary"), databaseId: newDb },
      { ...source[3], propertyId: ids.get("notes"), databaseId: newDb },
      { ...source[4], propertyId: ids.get("notes"), databaseId: newDb, personPropertyId: ids.get("owner") },
    ]);
    // secret's rule went with it; an exception for a person property left behind goes too.
    const withoutOwner = { ...plan, properties: plan.properties.filter((p) => p.id !== ids.get("owner")) };
    expect(planPropertyRules(source, withoutOwner).some((r) => r.personPropertyId)).toBe(false);
  });
});

describe("unknownToVisitors", () => {
  const anonymous = () => makeAccess(rules, { userId: "", groupIds: [], databaseLevel: "view" }, properties);

  it("hides what everyone's level keeps unknown, even with a person exception that could raise it", () => {
    const withPerson = new Map(rules).set("plain", [rule("plain", "none"), rule("plain", "view", { personPropertyId: "owner" })]);
    const access = makeAccess(withPerson, { userId: "", groupIds: [], databaseLevel: "view" }, properties);
    expect([...unknownToVisitors(access, properties)].sort()).toEqual(["plain", "secret"]);
    expect([...unknownToVisitors(anonymous(), properties)]).toEqual(["secret"]);
  });

  it("hides nothing without rules", () => {
    expect(unknownToVisitors(makeAccess(new Map(), viewer(""), properties), properties).size).toBe(0);
  });
});

describe("writableProperties", () => {
  it("keeps the properties whose values the writer may set in a new row", () => {
    expect(writableProperties(accessOf("u1"), properties, "u1").map((p) => p.id)).toEqual(["owner", "plain"]);
    expect(writableProperties(accessOf("u1", "full"), properties, null)).toBe(properties);
  });

  it("counts a created by exception for the row's creator", () => {
    const createdBy = [...properties, prop("creator", "created_by")];
    const byCreator = new Map([["plain", [rule("plain", "view"), rule("plain", "edit_values", { personPropertyId: "creator" })]]]);
    const access = makeAccess(byCreator, viewer("u1"), createdBy);
    expect(writableProperties(access, createdBy, "u1").some((p) => p.id === "plain")).toBe(true);
    expect(writableProperties(access, createdBy, null).some((p) => p.id === "plain")).toBe(false);
  });
});

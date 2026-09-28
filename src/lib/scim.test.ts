import { describe, expect, it } from "vitest";
import {
  applyGroupPatch,
  changesFromPatch,
  changesFromResource,
  emailOfResource,
  ERROR_SCHEMA,
  GROUP_SCHEMA,
  groupFromResource,
  groupResource,
  listResponse,
  MAX_PAGE_SIZE,
  memberIdsOf,
  pageOf,
  parseGroupFilter,
  parseUserFilter,
  schemaResources,
  ScimError,
  scimBoolean,
  userResource,
  USER_SCHEMA,
  wantsMembers,
  type GroupState,
} from "./scim";

const errorOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return error as ScimError;
  }
  throw new Error("did not throw");
};

describe("parseUserFilter", () => {
  it("reads the filters identity providers send", () => {
    expect(parseUserFilter('userName eq "ada@example.com"')).toEqual({ attribute: "userName", value: "ada@example.com" });
    expect(parseUserFilter('USERNAME EQ "a\\"b@example.com"')).toEqual({ attribute: "userName", value: 'a"b@example.com' });
    expect(parseUserFilter('externalId eq "00u1"')).toEqual({ attribute: "externalId", value: "00u1" });
    expect(parseUserFilter('emails[type eq "work"].value eq "ada@example.com"')).toEqual({
      attribute: "emails.value",
      value: "ada@example.com",
    });
    expect(parseUserFilter(null)).toBeNull();
    expect(parseUserFilter("  ")).toBeNull();
  });

  it("refuses anything else rather than answering with everyone", () => {
    for (const filter of ['userName co "ada"', 'userName eq "a" or userName eq "b"', 'title eq "x"', "userName eq ada"]) {
      const error = errorOf(() => parseUserFilter(filter));
      expect(error).toBeInstanceOf(ScimError);
      expect(error.body()).toEqual({ schemas: [ERROR_SCHEMA], status: "400", scimType: "invalidFilter", detail: error.detail });
    }
  });
});

describe("pageOf", () => {
  it("clamps startIndex and count", () => {
    expect(pageOf(new URLSearchParams())).toEqual({ startIndex: 1, count: 100 });
    expect(pageOf(new URLSearchParams("startIndex=0&count=-5"))).toEqual({ startIndex: 1, count: 0 });
    expect(pageOf(new URLSearchParams("startIndex=11&count=9999"))).toEqual({ startIndex: 11, count: MAX_PAGE_SIZE });
    expect(pageOf(new URLSearchParams("startIndex=x&count=y"))).toEqual({ startIndex: 1, count: 100 });
  });
});

describe("user resources", () => {
  it("accepts booleans as strings (Entra ID)", () => {
    expect(scimBoolean("False")).toBe(false);
    expect(scimBoolean(true)).toBe(true);
    expect(scimBoolean("no")).toBeNull();
  });

  it("reads the email of a new user", () => {
    expect(emailOfResource({ userName: " Ada@Example.com " })).toBe("ada@example.com");
    expect(emailOfResource({ userName: "ada", emails: [{ value: "x@example.com" }, { value: "ada@example.com", primary: true }] })).toBe(
      "ada@example.com",
    );
    expect(emailOfResource({ userName: "ada" })).toBeNull();
  });

  it("reads changes from a full resource", () => {
    expect(
      changesFromResource({ active: "true", externalId: "00u1", name: { givenName: "Ada", familyName: "Lovelace" } }),
    ).toEqual({ active: true, externalId: "00u1", name: "Ada Lovelace" });
    expect(changesFromResource({ displayName: "Ada L", externalId: "" })).toEqual({ externalId: null, name: "Ada L" });
    expect(errorOf(() => changesFromResource({ active: "maybe" })).scimType).toBe("invalidValue");
  });

  it("builds the resource clients read back", () => {
    const at = new Date("2026-01-02T03:04:05Z");
    const resource = userResource(
      { id: "u1", email: "ada@example.com", name: "Ada King Lovelace", active: false, externalId: "00u1", created: at, lastModified: at },
      "https://notes.example.com/scim/v2",
    );
    expect(resource).toMatchObject({
      schemas: [USER_SCHEMA],
      id: "u1",
      externalId: "00u1",
      userName: "ada@example.com",
      name: { formatted: "Ada King Lovelace", givenName: "Ada King", familyName: "Lovelace" },
      active: false,
      meta: { resourceType: "User", location: "https://notes.example.com/scim/v2/Users/u1", created: at.toISOString() },
    });
    expect(listResponse([resource], 7, 3)).toMatchObject({ totalResults: 7, startIndex: 3, itemsPerPage: 1 });
  });
});

describe("changesFromPatch", () => {
  it("deactivates the way Okta and Entra ID do", () => {
    expect(changesFromPatch({ Operations: [{ op: "replace", value: { active: false } }] })).toEqual({ active: false });
    expect(changesFromPatch({ Operations: [{ op: "Replace", path: "active", value: "False" }] })).toEqual({ active: false });
    expect(changesFromPatch({ operations: [{ op: "remove", path: "active" }] })).toEqual({ active: false });
  });

  it("renames from name parts and displayName, and ignores address changes", () => {
    expect(
      changesFromPatch({
        Operations: [
          { op: "replace", path: "name.givenName", value: "Ada" },
          { op: "replace", path: "name.familyName", value: "King" },
          { op: "replace", path: 'emails[type eq "work"].value', value: "other@example.com" },
          { op: "replace", path: "userName", value: "other@example.com" },
        ],
      }),
    ).toEqual({ name: "Ada King" });
    expect(changesFromPatch({ Operations: [{ op: "add", value: { displayName: "Ada", externalId: "x1" } }] })).toEqual({
      externalId: "x1",
      name: "Ada",
    });
    expect(
      changesFromPatch({ Operations: [{ op: "replace", path: "urn:ietf:params:scim:schemas:core:2.0:User:active", value: true }] }),
    ).toEqual({ active: true });
  });

  it("refuses what it can't do", () => {
    expect(errorOf(() => changesFromPatch({})).scimType).toBe("invalidSyntax");
    expect(errorOf(() => changesFromPatch({ Operations: [{ op: "move", path: "active" }] })).scimType).toBe("invalidSyntax");
    expect(errorOf(() => changesFromPatch({ Operations: [{ op: "replace", path: "roles", value: "admin" }] })).scimType).toBe(
      "invalidPath",
    );
    expect(errorOf(() => changesFromPatch({ Operations: [{ op: "replace", value: "x" }] })).scimType).toBe("noTarget");
    expect(errorOf(() => changesFromPatch({ Operations: [{ op: "replace", path: "active", value: "x" }] })).scimType).toBe(
      "invalidValue",
    );
  });
});

describe("parseGroupFilter", () => {
  it("reads the lookups Okta and Entra ID send", () => {
    expect(parseGroupFilter('displayName eq "Design Team"')).toEqual({ attribute: "displayName", value: "Design Team" });
    expect(parseGroupFilter('DISPLAYNAME eq "a \\"b\\""')).toEqual({ attribute: "displayName", value: 'a "b"' });
    expect(parseGroupFilter('externalId eq "00g1"')).toEqual({ attribute: "externalId", value: "00g1" });
    expect(parseGroupFilter('urn:ietf:params:scim:schemas:core:2.0:Group:displayName eq "x"')).toEqual({
      attribute: "displayName",
      value: "x",
    });
    expect(parseGroupFilter(undefined)).toBeNull();
  });

  it("refuses anything else", () => {
    for (const filter of ['displayName sw "De"', 'userName eq "a@b.c"', 'members[value eq "u1"]', 'displayName eq "a" and id eq "b"']) {
      expect(errorOf(() => parseGroupFilter(filter)).scimType).toBe("invalidFilter");
    }
  });
});

describe("group resources", () => {
  it("reads member ids", () => {
    expect(memberIdsOf([{ value: "u1", display: "Ada" }, { value: " u2 " }, { value: "u1" }])).toEqual(["u1", "u2"]);
    expect(memberIdsOf({ value: "u1" })).toEqual(["u1"]);
    expect(memberIdsOf(undefined)).toEqual([]);
    expect(errorOf(() => memberIdsOf([{ display: "no id" }])).scimType).toBe("invalidValue");
    expect(errorOf(() => memberIdsOf([{ value: "g1", type: "Group" }])).detail).toMatch(/Groups can't be members/);
  });

  it("reads a full resource, leaving out what it doesn't send", () => {
    expect(groupFromResource({ displayName: " Design ", externalId: "00g1", members: [{ value: "u1" }] })).toEqual({
      displayName: "Design",
      externalId: "00g1",
      members: ["u1"],
    });
    expect(groupFromResource({ displayName: "Design" })).toEqual({ displayName: "Design" });
    expect(groupFromResource({ externalId: "" })).toEqual({ externalId: null });
    expect(errorOf(() => groupFromResource({ displayName: "  " })).scimType).toBe("invalidValue");
    expect(errorOf(() => groupFromResource({ displayName: 5 })).scimType).toBe("invalidValue");
  });

  it("builds the resource clients read back", () => {
    const at = new Date("2026-01-02T03:04:05Z");
    const record = {
      id: "g 1",
      displayName: "Design",
      externalId: "00g1",
      members: [{ id: "u1", name: "Ada" }],
      created: at,
      lastModified: at,
    };
    const base = "https://notes.example.com/scim/v2";
    expect(groupResource(record, base)).toEqual({
      schemas: [GROUP_SCHEMA],
      id: "g 1",
      externalId: "00g1",
      displayName: "Design",
      members: [{ value: "u1", display: "Ada", type: "User", $ref: `${base}/Users/u1` }],
      meta: { resourceType: "Group", created: at.toISOString(), lastModified: at.toISOString(), location: `${base}/Groups/g%201` },
    });
    const bare = groupResource({ ...record, externalId: null }, base, false);
    expect(bare).not.toHaveProperty("members");
    expect(bare).not.toHaveProperty("externalId");
    expect(groupResource({ ...record, members: [] }, base).members).toEqual([]);
  });

  it("leaves members out when asked", () => {
    expect(wantsMembers(new URLSearchParams())).toBe(true);
    expect(wantsMembers(new URLSearchParams("excludedAttributes=members"))).toBe(false);
    expect(wantsMembers(new URLSearchParams("excludedAttributes=meta,urn:ietf:params:scim:schemas:core:2.0:Group:members"))).toBe(false);
    expect(wantsMembers(new URLSearchParams("attributes=displayName"))).toBe(false);
    expect(wantsMembers(new URLSearchParams("attributes=displayName,members.value"))).toBe(true);
  });

  it("describes both schemas", () => {
    const [userSchema, groupSchema] = schemaResources("https://x/scim/v2");
    expect(userSchema.id).toBe(USER_SCHEMA);
    expect(groupSchema).toMatchObject({ id: GROUP_SCHEMA, name: "Group", meta: { location: `https://x/scim/v2/Schemas/${GROUP_SCHEMA}` } });
    const members = groupSchema.attributes.find((a) => a.name === "members") as { multiValued: boolean; subAttributes: { name: string }[] };
    expect(members.multiValued).toBe(true);
    expect(members.subAttributes.map((a) => a.name)).toEqual(["value", "display", "type", "$ref"]);
    expect(groupSchema.attributes.find((a) => a.name === "displayName")).toMatchObject({ required: true, uniqueness: "server" });
  });
});

describe("applyGroupPatch", () => {
  const group: GroupState = { displayName: "Design", externalId: null, members: ["u1", "u2"] };
  const patch = (...Operations: unknown[]) =>
    applyGroupPatch(group, { schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"], Operations });

  it("follows Okta: add members, remove one by filter, rename path-less", () => {
    expect(patch({ op: "add", path: "members", value: [{ value: "u3", display: "Cy" }, { value: "u1" }] }).members).toEqual([
      "u1",
      "u2",
      "u3",
    ]);
    expect(patch({ op: "remove", path: 'members[value eq "u1"]' }).members).toEqual(["u2"]);
    expect(patch({ op: "remove", path: 'members[ value EQ "nobody" ]' }).members).toEqual(["u1", "u2"]);
    expect(patch({ op: "replace", value: { id: "g1", displayName: "Product Design" } })).toEqual({ ...group, displayName: "Product Design" });
    expect(patch({ op: "replace", path: "members", value: [{ value: "u9" }] }).members).toEqual(["u9"]);
  });

  it("follows Entra ID: capitalised ops, remove with a value list, displayName and externalId paths", () => {
    const moved = patch({ op: "Add", path: "members", value: [{ value: "u3" }] }, { op: "Remove", path: "members", value: [{ value: "u1" }] });
    expect(moved.members).toEqual(["u2", "u3"]);
    expect(patch({ op: "Replace", path: "displayName", value: "Designers" }).displayName).toBe("Designers");
    expect(patch({ op: "Replace", path: "externalId", value: "e-1" }).externalId).toBe("e-1");
    expect(patch({ op: "Remove", path: "externalId" }).externalId).toBeNull();
    expect(patch({ op: "Replace", path: "urn:ietf:params:scim:schemas:core:2.0:Group:displayName", value: "X" }).displayName).toBe("X");
  });

  it("empties the group on a remove without a value, and adds members path-less", () => {
    expect(patch({ op: "remove", path: "members" }).members).toEqual([]);
    expect(patch({ op: "add", value: { members: [{ value: "u3" }] } }).members).toEqual(["u1", "u2", "u3"]);
    expect(patch({ op: "replace", value: { members: [] } }).members).toEqual([]);
  });

  it("doesn't touch the group it was given", () => {
    patch({ op: "remove", path: "members" });
    expect(group.members).toEqual(["u1", "u2"]);
  });

  it("refuses what it can't do", () => {
    expect(errorOf(() => applyGroupPatch(group, {})).scimType).toBe("invalidSyntax");
    expect(errorOf(() => patch({ op: "copy", path: "members" })).scimType).toBe("invalidSyntax");
    expect(errorOf(() => patch({ op: "remove", path: "displayName" })).scimType).toBe("mutability");
    expect(errorOf(() => patch({ op: "replace", path: "displayName", value: "" })).scimType).toBe("invalidValue");
    expect(errorOf(() => patch({ op: "replace", path: "owners", value: [] })).scimType).toBe("invalidPath");
    expect(errorOf(() => patch({ op: "add", path: 'members[value eq "u3"]', value: {} })).scimType).toBe("invalidPath");
    expect(errorOf(() => patch({ op: "add", value: [{ value: "u3" }] })).scimType).toBe("noTarget");
    expect(errorOf(() => patch({ op: "add", path: "members", value: [{ value: 3 }] })).scimType).toBe("invalidValue");
  });
});

import { describe, expect, it } from "vitest";
import {
  changesFromPatch,
  changesFromResource,
  emailOfResource,
  ERROR_SCHEMA,
  listResponse,
  MAX_PAGE_SIZE,
  pageOf,
  parseUserFilter,
  ScimError,
  scimBoolean,
  userResource,
  USER_SCHEMA,
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

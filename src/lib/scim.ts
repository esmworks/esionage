/**
 * SCIM 2.0 (RFC 7643/7644) pieces that need no database: resources, filters, PATCH operations and
 * errors, as identity providers (Okta, Microsoft Entra ID, Google, JumpCloud…) send and expect them.
 */

export const SCIM_CONTENT_TYPE = "application/scim+json";
export const USER_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User";
export const GROUP_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:Group";
export const LIST_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:ListResponse";
export const ERROR_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:Error";
export const PATCH_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:PatchOp";

export const DEFAULT_PAGE_SIZE = 100;
export const MAX_PAGE_SIZE = 200;

export type ScimErrorType =
  | "invalidFilter"
  | "tooMany"
  | "uniqueness"
  | "mutability"
  | "invalidSyntax"
  | "invalidPath"
  | "noTarget"
  | "invalidValue";

/** An error SCIM clients understand: status, optional scimType, and a detail for people. */
export class ScimError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
    readonly scimType?: ScimErrorType,
  ) {
    super(detail);
    this.name = "ScimError";
  }

  body() {
    return {
      schemas: [ERROR_SCHEMA],
      status: String(this.status),
      ...(this.scimType ? { scimType: this.scimType } : {}),
      detail: this.detail,
    };
  }
}

/** The filters supported on /Users: one `eq` comparison on these attributes (what IdPs send). */
export const USER_FILTER_ATTRIBUTES = ["userName", "externalId", "emails.value", "id"] as const;
export type UserFilter = { attribute: (typeof USER_FILTER_ATTRIBUTES)[number]; value: string };

/** The filters supported on /Groups: one `eq` comparison, as Okta and Entra ID look groups up. */
export const GROUP_FILTER_ATTRIBUTES = ["displayName", "externalId", "id"] as const;
export type GroupFilter = { attribute: (typeof GROUP_FILTER_ATTRIBUTES)[number]; value: string };

function parseEqFilter<A extends string>(filter: string | null | undefined, attributes: readonly A[], example: string) {
  if (filter === null || filter === undefined || !filter.trim()) return null;
  const match = /^\s*([A-Za-z.:0-9]+|emails\[[^\]]*\]\.value)\s+eq\s+"((?:[^"\\]|\\.)*)"\s*$/i.exec(filter);
  if (!match) throw new ScimError(400, `Only filters of the form \`${example} eq "value"\` are supported.`, "invalidFilter");
  const raw = match[1]
    .toLowerCase()
    .replace(/^emails\[[^\]]*\]\.value$/, "emails.value")
    .replace(/^urn:ietf:params:scim:schemas:core:2\.0:(user|group):/, "");
  const attribute = attributes.find((a) => a.toLowerCase() === raw);
  if (!attribute) throw new ScimError(400, `Filtering on ${match[1]} is not supported.`, "invalidFilter");
  return { attribute, value: match[2].replace(/\\(.)/g, "$1") };
}

/**
 * Parses `userName eq "a@b.com"` (attribute names are case-insensitive, `emails[type eq "work"].value`
 * counts as emails.value). Anything else is a 400 invalidFilter, so a client never gets an
 * unfiltered list it takes for a match.
 */
export function parseUserFilter(filter: string | null | undefined): UserFilter | null {
  return parseEqFilter(filter, USER_FILTER_ATTRIBUTES, "userName");
}

/** Parses `displayName eq "Design"` (or externalId, id) like parseUserFilter. */
export function parseGroupFilter(filter: string | null | undefined): GroupFilter | null {
  return parseEqFilter(filter, GROUP_FILTER_ATTRIBUTES, "displayName");
}

/** startIndex (1-based) and count from the query, clamped. */
export function pageOf(params: URLSearchParams) {
  const start = Math.max(1, Math.floor(Number(params.get("startIndex") ?? "1")) || 1);
  const rawCount = params.get("count");
  const count = rawCount === null ? DEFAULT_PAGE_SIZE : Math.floor(Number(rawCount));
  return { startIndex: start, count: Number.isFinite(count) ? Math.min(MAX_PAGE_SIZE, Math.max(0, count)) : DEFAULT_PAGE_SIZE };
}

/** SCIM booleans arrive as true/false, or as strings from some clients (Entra ID sends "False"). */
export function scimBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const lower = value.trim().toLowerCase();
    if (lower === "true") return true;
    if (lower === "false") return false;
  }
  return null;
}

/** What a create, replace or patch asks to change on a user; undefined leaves it as it is. */
export type UserChanges = {
  active?: boolean;
  externalId?: string | null;
  name?: string;
};

function nameFrom(value: Record<string, unknown>): string | undefined {
  const name = value.name as Record<string, unknown> | undefined;
  const formatted = typeof name?.formatted === "string" ? name.formatted.trim() : "";
  if (formatted) return formatted;
  const parts = [name?.givenName, name?.familyName].filter((p): p is string => typeof p === "string" && !!p.trim());
  if (parts.length) return parts.map((p) => p.trim()).join(" ");
  if (typeof value.displayName === "string" && value.displayName.trim()) return value.displayName.trim();
  return undefined;
}

/** The changes a full user resource (POST, PUT) carries. */
export function changesFromResource(resource: Record<string, unknown>): UserChanges {
  const changes: UserChanges = {};
  if (resource.active !== undefined) {
    const active = scimBoolean(resource.active);
    if (active === null) throw new ScimError(400, "active must be true or false.", "invalidValue");
    changes.active = active;
  }
  if (resource.externalId !== undefined) {
    changes.externalId = typeof resource.externalId === "string" && resource.externalId ? resource.externalId : null;
  }
  const name = nameFrom(resource);
  if (name) changes.name = name;
  return changes;
}

/** The email a new user resource is for: its userName when that is an address, else its primary email. */
export function emailOfResource(resource: Record<string, unknown>): string | null {
  const isEmail = (v: unknown): v is string => typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
  if (isEmail(resource.userName)) return resource.userName.trim().toLowerCase();
  const emails = Array.isArray(resource.emails) ? (resource.emails as Record<string, unknown>[]) : [];
  const chosen = emails.find((e) => e?.primary === true && isEmail(e.value)) ?? emails.find((e) => isEmail(e?.value));
  return chosen ? String(chosen.value).trim().toLowerCase() : null;
}

type PatchOperation = { op?: unknown; path?: unknown; value?: unknown };

/**
 * The changes of a PatchOp request. Supported paths: active, externalId, displayName, name and its
 * parts (a path-less operation carries them as an object). Paths about the address (userName,
 * emails) are accepted and ignored: an account's email belongs to its owner, not to one workspace.
 */
export function changesFromPatch(body: Record<string, unknown>): UserChanges {
  const operations = body.Operations ?? body.operations;
  if (!Array.isArray(operations) || !operations.length) throw new ScimError(400, "Send Operations.", "invalidSyntax");
  const changes: UserChanges = {};
  const name: Record<string, unknown> = {};
  const apply = (path: string, value: unknown, op: string) => {
    const key = path.toLowerCase().replace(/^urn:ietf:params:scim:schemas:core:2\.0:user:/, "");
    if (key === "active") {
      const active = op === "remove" ? false : scimBoolean(value);
      if (active === null) throw new ScimError(400, "active must be true or false.", "invalidValue");
      changes.active = active;
    } else if (key === "externalid") {
      changes.externalId = op === "remove" || typeof value !== "string" || !value ? null : value;
    } else if (key === "displayname") {
      if (typeof value === "string" && value.trim()) name.displayName = value;
    } else if (key === "name") {
      if (value && typeof value === "object") Object.assign(name, { name: value });
    } else if (key === "name.formatted" || key === "name.givenname" || key === "name.familyname") {
      const part = { "name.formatted": "formatted", "name.givenname": "givenName", "name.familyname": "familyName" }[key]!;
      name.name = { ...(name.name as object | undefined), [part]: value };
    } else if (key === "username" || key.startsWith("emails") || key === "title" || key.startsWith("phonenumbers") || key.startsWith("addresses")) {
      // Ignored, see above.
    } else {
      throw new ScimError(400, `Changing ${path} is not supported.`, "invalidPath");
    }
  };
  for (const raw of operations as PatchOperation[]) {
    const op = typeof raw?.op === "string" ? raw.op.toLowerCase() : "";
    if (op !== "add" && op !== "replace" && op !== "remove") throw new ScimError(400, `Unknown op ${String(raw?.op)}.`, "invalidSyntax");
    if (typeof raw.path === "string" && raw.path) {
      apply(raw.path, raw.value, op);
    } else if (raw.value && typeof raw.value === "object" && !Array.isArray(raw.value)) {
      for (const [path, value] of Object.entries(raw.value as Record<string, unknown>)) apply(path, value, op);
    } else {
      throw new ScimError(400, "An operation without a path needs an object value.", "noTarget");
    }
  }
  const newName = nameFrom(name);
  if (newName) changes.name = newName;
  return changes;
}

export type ScimUserRecord = {
  id: string;
  email: string;
  name: string;
  active: boolean;
  externalId: string | null;
  created: Date;
  lastModified: Date;
};

export function userResource(record: ScimUserRecord, baseUrl: string) {
  const parts = record.name.trim().split(/\s+/);
  return {
    schemas: [USER_SCHEMA],
    id: record.id,
    ...(record.externalId ? { externalId: record.externalId } : {}),
    userName: record.email,
    name: {
      formatted: record.name,
      ...(parts.length > 1 ? { givenName: parts.slice(0, -1).join(" "), familyName: parts[parts.length - 1] } : { givenName: record.name }),
    },
    displayName: record.name,
    emails: [{ value: record.email, type: "work", primary: true }],
    active: record.active,
    meta: {
      resourceType: "User",
      created: record.created.toISOString(),
      lastModified: record.lastModified.toISOString(),
      location: `${baseUrl}/Users/${encodeURIComponent(record.id)}`,
    },
  };
}

export function listResponse(resources: unknown[], totalResults: number, startIndex: number) {
  return { schemas: [LIST_SCHEMA], totalResults, startIndex, itemsPerPage: resources.length, Resources: resources };
}

export function serviceProviderConfig(baseUrl: string) {
  return {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: MAX_PAGE_SIZE },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [
      {
        type: "oauthbearertoken",
        name: "Bearer token",
        description: "A SCIM token from Settings > Security, sent as Authorization: Bearer scim_…",
        primary: true,
      },
    ],
    meta: { resourceType: "ServiceProviderConfig", location: `${baseUrl}/ServiceProviderConfig` },
  };
}

export function resourceTypes(baseUrl: string) {
  const type = (name: string, schema: string) => ({
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"],
    id: name,
    name,
    endpoint: `/${name}s`,
    schema,
    meta: { resourceType: "ResourceType", location: `${baseUrl}/ResourceTypes/${name}` },
  });
  return [type("User", USER_SCHEMA), type("Group", GROUP_SCHEMA)];
}

// ------------------------------------------------------------------------------------------ groups

/** A group as SCIM sees it: its name, the provider's id for it and the SCIM user ids in it. */
export type GroupState = { displayName: string; externalId: string | null; members: string[] };

const GROUP_URN = /^urn:ietf:params:scim:schemas:core:2\.0:group:/i;
const MEMBER_PATH = /^members\s*\[\s*value\s+eq\s+"((?:[^"\\]|\\.)*)"\s*\]$/i;

/**
 * The user ids of a SCIM `members` value: an array of `{ value: "<user id>" }` (one object alone
 * is taken as a list of one; `display`, `$ref` are ignored). Groups can't be members of groups.
 */
export function memberIdsOf(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  const ids = (Array.isArray(value) ? value : [value]).map((item) => {
    const entry = item && typeof item === "object" ? (item as Record<string, unknown>) : null;
    if (typeof entry?.type === "string" && entry.type.toLowerCase() === "group") {
      throw new ScimError(400, "Groups can't be members of groups.", "invalidValue");
    }
    const id = entry ? entry.value : item;
    if (typeof id !== "string" || !id.trim()) throw new ScimError(400, "Each member needs a value: the id of a user.", "invalidValue");
    return id.trim();
  });
  return [...new Set(ids)];
}

function displayNameOf(value: unknown) {
  if (typeof value !== "string" || !value.trim()) throw new ScimError(400, "displayName must be a non-empty string.", "invalidValue");
  return value.trim();
}

/** What a full group resource (POST, PUT) carries; attributes it leaves out are undefined. */
export function groupFromResource(resource: Record<string, unknown>): Partial<GroupState> {
  const group: Partial<GroupState> = {};
  if (resource.displayName !== undefined) group.displayName = displayNameOf(resource.displayName);
  if (resource.externalId !== undefined) {
    group.externalId = typeof resource.externalId === "string" && resource.externalId ? resource.externalId : null;
  }
  if (resource.members !== undefined) group.members = memberIdsOf(resource.members);
  return group;
}

/**
 * Applies a PatchOp request to a group and returns the result; nothing is saved here. Supports
 * what Okta and Microsoft Entra ID send: `add`/`remove`/`replace` on `members` (a remove without a
 * value empties the group), `remove` on `members[value eq "<id>"]`, `displayName` and
 * `externalId`, and path-less operations whose value is an object of those (`id`, `schemas` and
 * `meta` in it are ignored). Op names are case-insensitive.
 */
export function applyGroupPatch(group: GroupState, body: Record<string, unknown>): GroupState {
  const operations = body.Operations ?? body.operations;
  if (!Array.isArray(operations) || !operations.length) throw new ScimError(400, "Send Operations.", "invalidSyntax");
  const next: GroupState = { ...group, members: [...group.members] };
  const apply = (path: string, value: unknown, op: string) => {
    const bare = path.trim().replace(GROUP_URN, "");
    const one = MEMBER_PATH.exec(bare);
    if (one) {
      if (op !== "remove") throw new ScimError(400, `Use remove with ${path}, or add to members.`, "invalidPath");
      const id = one[1].replace(/\\(.)/g, "$1");
      next.members = next.members.filter((m) => m !== id);
      return;
    }
    switch (bare.toLowerCase()) {
      case "members": {
        if (op === "replace") next.members = memberIdsOf(value);
        else if (op === "add") next.members = [...new Set([...next.members, ...memberIdsOf(value)])];
        else if (value === undefined || value === null) next.members = [];
        else {
          const gone = new Set(memberIdsOf(value));
          next.members = next.members.filter((m) => !gone.has(m));
        }
        return;
      }
      case "displayname":
        if (op === "remove") throw new ScimError(400, "A group needs a displayName.", "mutability");
        next.displayName = displayNameOf(value);
        return;
      case "externalid":
        next.externalId = op === "remove" || typeof value !== "string" || !value ? null : value;
        return;
      default:
        throw new ScimError(400, `Changing ${path} is not supported.`, "invalidPath");
    }
  };
  for (const raw of operations as PatchOperation[]) {
    const op = typeof raw?.op === "string" ? raw.op.toLowerCase() : "";
    if (op !== "add" && op !== "replace" && op !== "remove") throw new ScimError(400, `Unknown op ${String(raw?.op)}.`, "invalidSyntax");
    if (typeof raw.path === "string" && raw.path.trim()) {
      apply(raw.path, raw.value, op);
    } else if (raw.value && typeof raw.value === "object" && !Array.isArray(raw.value)) {
      for (const [path, value] of Object.entries(raw.value as Record<string, unknown>)) {
        if (!["id", "schemas", "meta"].includes(path.replace(GROUP_URN, "").toLowerCase())) apply(path, value, op);
      }
    } else {
      throw new ScimError(400, "An operation without a path needs an object value.", "noTarget");
    }
  }
  return next;
}

/**
 * Whether a response should carry `members`: not when the client asked to leave them out
 * (`excludedAttributes=members`, which Entra ID sends when it only checks a group exists) or
 * listed `attributes` without them.
 */
export function wantsMembers(params: URLSearchParams) {
  const names = (key: string) =>
    (params.get(key) ?? "")
      .split(",")
      .map((a) => a.trim().replace(GROUP_URN, "").toLowerCase())
      .filter(Boolean);
  if (names("excludedAttributes").includes("members")) return false;
  const only = names("attributes");
  return !only.length || only.some((a) => a === "members" || a.startsWith("members."));
}

export type ScimGroupRecord = {
  id: string;
  displayName: string;
  externalId: string | null;
  members: { id: string; name: string }[];
  created: Date;
  lastModified: Date;
};

export function groupResource(record: ScimGroupRecord, baseUrl: string, withMembers = true) {
  return {
    schemas: [GROUP_SCHEMA],
    id: record.id,
    ...(record.externalId ? { externalId: record.externalId } : {}),
    displayName: record.displayName,
    ...(withMembers
      ? {
          members: record.members.map((m) => ({
            value: m.id,
            display: m.name,
            type: "User",
            $ref: `${baseUrl}/Users/${encodeURIComponent(m.id)}`,
          })),
        }
      : {}),
    meta: {
      resourceType: "Group",
      created: record.created.toISOString(),
      lastModified: record.lastModified.toISOString(),
      location: `${baseUrl}/Groups/${encodeURIComponent(record.id)}`,
    },
  };
}

// ----------------------------------------------------------------------------------------- schemas

type Attribute = {
  name: string;
  type: "string" | "boolean" | "complex" | "reference";
  multiValued?: boolean;
  required?: boolean;
  mutability?: "readOnly" | "readWrite" | "immutable";
  uniqueness?: "none" | "server";
  description?: string;
  canonicalValues?: string[];
  referenceTypes?: string[];
  subAttributes?: Attribute[];
};

function attribute({ subAttributes, ...a }: Attribute): Record<string, unknown> {
  return {
    name: a.name,
    type: a.type,
    multiValued: a.multiValued ?? false,
    ...(a.description ? { description: a.description } : {}),
    required: a.required ?? false,
    caseExact: false,
    mutability: a.mutability ?? "readWrite",
    returned: "default",
    uniqueness: a.uniqueness ?? "none",
    ...(a.canonicalValues ? { canonicalValues: a.canonicalValues } : {}),
    ...(a.referenceTypes ? { referenceTypes: a.referenceTypes } : {}),
    ...(subAttributes ? { subAttributes: subAttributes.map(attribute) } : {}),
  };
}

/** /Schemas: the User and Group attributes this server reads and returns (RFC 7643 §7). */
export function schemaResources(baseUrl: string) {
  const schema = (id: string, name: string, description: string, attributes: Attribute[]) => ({
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:Schema"],
    id,
    name,
    description,
    attributes: attributes.map(attribute),
    meta: { resourceType: "Schema", location: `${baseUrl}/Schemas/${id}` },
  });
  return [
    schema(USER_SCHEMA, "User", "An owner or member of the workspace, or someone its provider deactivated.", [
      { name: "userName", type: "string", required: true, uniqueness: "server", description: "The account's email address." },
      {
        name: "name",
        type: "complex",
        subAttributes: [
          { name: "formatted", type: "string" },
          { name: "givenName", type: "string" },
          { name: "familyName", type: "string" },
        ],
      },
      { name: "displayName", type: "string" },
      {
        name: "emails",
        type: "complex",
        multiValued: true,
        subAttributes: [
          { name: "value", type: "string" },
          { name: "type", type: "string" },
          { name: "primary", type: "boolean" },
        ],
      },
      { name: "active", type: "boolean", description: "false removes the person from the workspace." },
    ]),
    schema(GROUP_SCHEMA, "Group", "A member group of the workspace.", [
      { name: "displayName", type: "string", required: true, uniqueness: "server", description: "Unique in the workspace, ignoring case." },
      {
        name: "members",
        type: "complex",
        multiValued: true,
        description: "Owners and members of the workspace; guests can't be in groups.",
        subAttributes: [
          { name: "value", type: "string", mutability: "immutable", description: "The user's SCIM id." },
          { name: "display", type: "string", mutability: "readOnly" },
          { name: "type", type: "string", mutability: "immutable", canonicalValues: ["User"] },
          { name: "$ref", type: "reference", mutability: "immutable", referenceTypes: ["User"] },
        ],
      },
    ]),
  ];
}

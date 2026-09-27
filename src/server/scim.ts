import { and, count, desc, eq, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { scimIdentity, scimToken, ssoProvider, user, workspaceMember, workspaceSso } from "@/db/schema";
import { cleanName } from "@/lib/account";
import { env } from "@/lib/env";
import { sharedLimiter } from "@/lib/rate-limit";
import {
  changesFromPatch,
  changesFromResource,
  emailOfResource,
  GROUP_SCHEMA,
  listResponse,
  pageOf,
  parseUserFilter,
  resourceTypes,
  SCIM_CONTENT_TYPE,
  ScimError,
  serviceProviderConfig,
  userResource,
  USER_SCHEMA,
  type ScimUserRecord,
  type UserChanges,
} from "@/lib/scim";
import { domainsFromColumn, emailInDomains } from "@/lib/sso-config";
import { requireMembership } from "@/server/access";
import { generateTokenSecret, hashToken } from "@/server/api/tokens";
import { joinAsMember, removeMemberByProvider, WorkspaceError } from "@/server/workspaces";

/**
 * SCIM 2.0 provisioning (/scim/v2): a workspace's identity provider adds people to the workspace,
 * deactivates them (they leave it) and removes them, with a SCIM token an owner created in Settings
 * > Security. The token is the workspace's, not a person's: like API tokens it is outside the
 * workspaces' sign-in policies, and only its SHA-256 hash is stored.
 *
 * Users are the workspace's owners and members, plus the people its provider deactivated (kept
 * with `active: false` so it can turn them back on). The SCIM id is the account id. New accounts
 * are created only for addresses in the workspace's verified SSO domains; anyone else must already
 * have an account. Guests aren't listed; provisioning one makes them a member. Owners can't be
 * deactivated or removed over SCIM, so a provider can't take a workspace away from its owners.
 *
 * Groups: workspaces don't have member groups yet, so /Groups lists none and refuses changes (501).
 */

export const SCIM_PREFIX = "/scim/v2";
export const SCIM_TOKEN_PREFIX = "scim_";
export const SCIM_TOKEN_PATTERN = /^scim_[A-Za-z0-9]{40}$/;
export const MAX_SCIM_TOKENS = 20;
export const MAX_SCIM_TOKEN_NAME = 100;
/** Requests per token per minute. */
export const SCIM_RATE_LIMIT = 600;
const TOUCH_INTERVAL_MS = 60_000;
const MAX_BODY_BYTES = 1024 * 1024;

export class ScimTokenError extends Error {
  constructor(
    message: string,
    readonly code: "name" | "limit",
  ) {
    super(message);
    this.name = "ScimTokenError";
  }
}

// ------------------------------------------------------------------------------------------ tokens

export type ScimTokenInfo = { id: string; name: string; prefix: string; createdAt: Date; lastUsedAt: Date | null };

/** Creates a SCIM token for the workspace and returns its secret, shown once. Owners only. */
export async function createScimToken(actorId: string, workspaceId: string, name: string) {
  await requireMembership(actorId, workspaceId, "owner");
  const clean = name.trim();
  if (!clean || clean.length > MAX_SCIM_TOKEN_NAME) {
    throw new ScimTokenError(`Give the token a name of at most ${MAX_SCIM_TOKEN_NAME} characters`, "name");
  }
  const [{ n }] = await db.select({ n: count() }).from(scimToken).where(eq(scimToken.workspaceId, workspaceId));
  if (n >= MAX_SCIM_TOKENS) throw new ScimTokenError(`A workspace can have at most ${MAX_SCIM_TOKENS} SCIM tokens`, "limit");
  const secret = SCIM_TOKEN_PREFIX + generateTokenSecret().slice(4);
  const [row] = await db
    .insert(scimToken)
    .values({ workspaceId, name: clean, prefix: secret.slice(0, SCIM_TOKEN_PREFIX.length + 4), tokenHash: hashToken(secret), createdBy: actorId })
    .returning({ id: scimToken.id, name: scimToken.name, prefix: scimToken.prefix, createdAt: scimToken.createdAt, lastUsedAt: scimToken.lastUsedAt });
  return { secret, token: row as ScimTokenInfo };
}

export async function listScimTokens(actorId: string, workspaceId: string): Promise<ScimTokenInfo[]> {
  await requireMembership(actorId, workspaceId, "owner");
  return db
    .select({ id: scimToken.id, name: scimToken.name, prefix: scimToken.prefix, createdAt: scimToken.createdAt, lastUsedAt: scimToken.lastUsedAt })
    .from(scimToken)
    .where(eq(scimToken.workspaceId, workspaceId))
    .orderBy(desc(scimToken.createdAt));
}

export async function revokeScimToken(actorId: string, workspaceId: string, tokenId: string) {
  await requireMembership(actorId, workspaceId, "owner");
  const deleted = await db
    .delete(scimToken)
    .where(and(eq(scimToken.id, tokenId), eq(scimToken.workspaceId, workspaceId)))
    .returning({ id: scimToken.id });
  return deleted.length > 0;
}

/** The workspace and token a presented secret belongs to, or null. Records its use (once a minute). */
export async function verifyScimToken(secret: string, now = new Date()) {
  if (!SCIM_TOKEN_PATTERN.test(secret)) return null;
  const [row] = await db.select().from(scimToken).where(eq(scimToken.tokenHash, hashToken(secret))).limit(1);
  if (!row) return null;
  if (!row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() >= TOUCH_INTERVAL_MS) {
    await db.update(scimToken).set({ lastUsedAt: now }).where(eq(scimToken.id, row.id));
  }
  return { tokenId: row.id, workspaceId: row.workspaceId };
}

// ------------------------------------------------------------------------------------------- users

/** Verified SSO domains of the workspace: SCIM creates accounts and renames people only there. */
async function verifiedDomains(workspaceId: string) {
  const [row] = await db
    .select({ domain: ssoProvider.domain })
    .from(workspaceSso)
    .innerJoin(ssoProvider, eq(ssoProvider.providerId, workspaceSso.providerId))
    .where(and(eq(workspaceSso.workspaceId, workspaceId), eq(ssoProvider.domainVerified, true)))
    .limit(1);
  return domainsFromColumn(row?.domain);
}

const inScope = (workspaceId: string) =>
  or(
    sql`exists (select 1 from ${workspaceMember} m where m.workspace_id = ${workspaceId} and m.user_id = ${user.id} and m.role in ('owner', 'member'))`,
    sql`exists (select 1 from ${scimIdentity} i where i.workspace_id = ${workspaceId} and i.user_id = ${user.id})`,
  );

/** Users of the workspace as SCIM sees them (see the note at the top), optionally only some ids. */
async function records(workspaceId: string, where?: ReturnType<typeof sql>, page?: { offset: number; limit: number }) {
  const query = db
    .select({
      id: user.id,
      email: user.email,
      name: user.name,
      userCreated: user.createdAt,
      userUpdated: user.updatedAt,
      role: sql<string | null>`(select m.role from ${workspaceMember} m where m.workspace_id = ${workspaceId} and m.user_id = ${user.id})`,
      externalId: sql<string | null>`(select i.external_id from ${scimIdentity} i where i.workspace_id = ${workspaceId} and i.user_id = ${user.id})`,
      identityUpdated: sql<Date | null>`(select i.updated_at from ${scimIdentity} i where i.workspace_id = ${workspaceId} and i.user_id = ${user.id})`,
    })
    .from(user)
    .where(and(inScope(workspaceId), where))
    .orderBy(user.createdAt, user.id);
  const rows = page ? await query.offset(page.offset).limit(page.limit) : await query;
  return rows.map(
    (r): ScimUserRecord & { role: string | null } => ({
      id: r.id,
      email: r.email,
      name: r.name,
      role: r.role,
      active: r.role === "owner" || r.role === "member",
      externalId: r.externalId,
      created: new Date(r.userCreated),
      lastModified: new Date(
        Math.max(new Date(r.userUpdated).getTime(), r.identityUpdated ? new Date(r.identityUpdated).getTime() : 0),
      ),
    }),
  );
}

function filterSql(filter: ReturnType<typeof parseUserFilter>) {
  if (!filter) return undefined;
  switch (filter.attribute) {
    case "userName":
    case "emails.value":
      return sql`lower(${user.email}) = ${filter.value.trim().toLowerCase()}`;
    case "id":
      return eq(user.id, filter.value);
    case "externalId":
      return sql`exists (select 1 from ${scimIdentity} i where i.user_id = ${user.id} and i.external_id = ${filter.value})`;
  }
}

async function listUsers(workspaceId: string, params: URLSearchParams, baseUrl: string) {
  const filter = parseUserFilter(params.get("filter"));
  const { startIndex, count: size } = pageOf(params);
  const where = filterSql(filter);
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(user)
    .where(and(inScope(workspaceId), where));
  const rows = size > 0 ? await records(workspaceId, where, { offset: startIndex - 1, limit: size }) : [];
  return listResponse(
    rows.map((r) => userResource(r, baseUrl)),
    Number(total),
    startIndex,
  );
}

async function findRecord(workspaceId: string, id: string) {
  const [row] = await records(workspaceId, eq(user.id, id));
  if (!row) throw new ScimError(404, `User ${id} not found.`);
  return row;
}

async function setIdentity(workspaceId: string, userId: string, fields: { active: boolean; externalId?: string | null }) {
  await db
    .insert(scimIdentity)
    .values({ workspaceId, userId, active: fields.active, externalId: fields.externalId ?? null })
    .onConflictDoUpdate({
      target: [scimIdentity.workspaceId, scimIdentity.userId],
      set: { active: fields.active, updatedAt: new Date(), ...(fields.externalId !== undefined ? { externalId: fields.externalId } : {}) },
    });
}

/**
 * Applies what a request asks for: membership follows `active` (owners stay), the external id is
 * kept, and the name changes only for addresses in the workspace's verified domains.
 */
async function applyChanges(workspaceId: string, record: { id: string; email: string; role: string | null }, changes: UserChanges) {
  if (changes.active === false && record.role === "owner") {
    throw new ScimError(400, "Workspace owners can't be deactivated over SCIM; change their role in the app first.", "mutability");
  }
  if (changes.active === true && record.role !== "owner" && record.role !== "member") {
    if (record.role === "guest") await promoteGuest(workspaceId, record.id);
    else await joinAsMember(workspaceId, record.id, record.email);
  }
  if (changes.active === false && record.role === "member") await removeMemberByProvider(workspaceId, record.id);
  const active = changes.active ?? (record.role === "owner" || record.role === "member");
  await setIdentity(workspaceId, record.id, { active, externalId: changes.externalId });
  if (changes.name && emailInDomains(record.email, await verifiedDomains(workspaceId))) {
    const clean = cleanName(changes.name);
    if (clean.ok) await db.update(user).set({ name: clean.name }).where(eq(user.id, record.id));
  }
}

async function promoteGuest(workspaceId: string, userId: string) {
  await db
    .update(workspaceMember)
    .set({ role: "member" })
    .where(and(eq(workspaceMember.workspaceId, workspaceId), eq(workspaceMember.userId, userId), eq(workspaceMember.role, "guest")));
}

async function createUser(workspaceId: string, resource: Record<string, unknown>) {
  const email = emailOfResource(resource);
  if (!email) throw new ScimError(400, "userName (or a primary email) must be an email address.", "invalidValue");
  const changes = changesFromResource(resource);
  const [existing] = await db
    .select({ id: user.id })
    .from(user)
    .where(sql`lower(${user.email}) = ${email}`)
    .limit(1);
  let userId = existing?.id;
  if (userId) {
    const [known] = await records(workspaceId, eq(user.id, userId));
    if (known) throw new ScimError(409, `${email} is already provisioned in this workspace.`, "uniqueness");
  } else {
    if (!emailInDomains(email, await verifiedDomains(workspaceId))) {
      throw new ScimError(
        400,
        `No account uses ${email}. SCIM creates accounts only for the workspace's verified single sign-on domains.`,
        "invalidValue",
      );
    }
    const clean = cleanName(changes.name ?? email.split("@")[0]);
    userId = crypto.randomUUID();
    await db.insert(user).values({ id: userId, email, name: clean.ok ? clean.name : email.split("@")[0], emailVerified: true });
  }
  const [membership] = await db
    .select({ role: workspaceMember.role })
    .from(workspaceMember)
    .where(and(eq(workspaceMember.workspaceId, workspaceId), eq(workspaceMember.userId, userId)))
    .limit(1);
  await applyChanges(workspaceId, { id: userId, email, role: membership?.role ?? null }, { active: true, ...changes, name: existing ? undefined : changes.name });
  return findRecord(workspaceId, userId);
}

async function deleteUser(workspaceId: string, id: string) {
  const record = await findRecord(workspaceId, id);
  if (record.role === "owner") {
    throw new ScimError(400, "Workspace owners can't be removed over SCIM; change their role in the app first.", "mutability");
  }
  if (record.role === "member") await removeMemberByProvider(workspaceId, id);
  await db.delete(scimIdentity).where(and(eq(scimIdentity.workspaceId, workspaceId), eq(scimIdentity.userId, id)));
}

// ------------------------------------------------------------------------------------------- HTTP

function scimJson(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": `${SCIM_CONTENT_TYPE}; charset=utf-8`, "Cache-Control": "no-store", ...headers },
  });
}

const errorResponse = (error: ScimError, headers: Record<string, string> = {}) => scimJson(error.status, error.body(), headers);

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) throw new ScimError(413, "The request body is too large.");
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {}
  throw new ScimError(400, "The request body must be a JSON object.", "invalidSyntax");
}

const notImplemented = () => new ScimError(501, "This workspace has no member groups to provision yet.");

/** Every /scim/v2 request (route: src/app/scim/v2/[[...path]]/route.ts). */
export async function handleScimRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const baseUrl = `${env.appUrl}${SCIM_PREFIX}`;
  const path = (url.pathname.startsWith(SCIM_PREFIX) ? url.pathname.slice(SCIM_PREFIX.length) : url.pathname).replace(/\/+$/, "") || "/";
  const method = request.method.toUpperCase();

  const secret = /^Bearer\s+(\S+)\s*$/i.exec(request.headers.get("authorization") ?? "")?.[1];
  const principal = secret ? await verifyScimToken(secret) : null;
  if (!principal) {
    return errorResponse(new ScimError(401, "Send a SCIM token from Settings > Security: Authorization: Bearer scim_…"), {
      "WWW-Authenticate": 'Bearer realm="esionage-scim"',
    });
  }
  const limiter = sharedLimiter("scim", SCIM_RATE_LIMIT, 60_000);
  const wait = limiter.retryAfter(principal.tokenId);
  if (wait > 0) return errorResponse(new ScimError(429, "Too many requests."), { "Retry-After": String(Math.ceil(wait / 1000)) });
  limiter.hit(principal.tokenId);
  const { workspaceId } = principal;

  try {
    const [, collection, id, ...rest] = path.split("/");
    if (rest.length) throw new ScimError(404, "There is no such endpoint.");
    const only = (...allowed: string[]) => {
      if (!allowed.includes(method)) throw new ScimError(405, `Use ${allowed.join(", ")}.`);
    };
    switch (collection) {
      case "ServiceProviderConfig":
        only("GET");
        return scimJson(200, serviceProviderConfig(baseUrl));
      case "ResourceTypes": {
        only("GET");
        const types = resourceTypes(baseUrl);
        if (id) {
          const type = types.find((t) => t.id === id);
          if (!type) throw new ScimError(404, `No resource type ${id}.`);
          return scimJson(200, type);
        }
        return scimJson(200, listResponse(types, types.length, 1));
      }
      case "Schemas": {
        only("GET");
        const schemas = [USER_SCHEMA, GROUP_SCHEMA].map((schemaId) => ({
          schemas: ["urn:ietf:params:scim:schemas:core:2.0:Schema"],
          id: schemaId,
          name: schemaId.endsWith("User") ? "User" : "Group",
          attributes: [],
        }));
        return scimJson(200, id ? (schemas.find((s) => s.id === id) ?? schemas[0]) : listResponse(schemas, schemas.length, 1));
      }
      case "Users": {
        if (!id) {
          only("GET", "POST");
          if (method === "GET") return scimJson(200, await listUsers(workspaceId, url.searchParams, baseUrl));
          const created = await createUser(workspaceId, await readJson(request));
          const resource = userResource(created, baseUrl);
          return scimJson(201, resource, { Location: resource.meta.location });
        }
        only("GET", "PUT", "PATCH", "DELETE");
        if (method === "DELETE") {
          await deleteUser(workspaceId, id);
          return scimJson(204, null);
        }
        const record = await findRecord(workspaceId, id);
        if (method === "PUT") await applyChanges(workspaceId, record, changesFromResource(await readJson(request)));
        if (method === "PATCH") await applyChanges(workspaceId, record, changesFromPatch(await readJson(request)));
        return scimJson(200, userResource(await findRecord(workspaceId, id), baseUrl));
      }
      case "Groups": {
        if (method === "GET") {
          if (id) throw new ScimError(404, `Group ${id} not found.`);
          return scimJson(200, listResponse([], 0, 1));
        }
        only("GET", "POST", "PUT", "PATCH", "DELETE");
        throw notImplemented();
      }
      default:
        throw new ScimError(404, "There is no such endpoint.");
    }
  } catch (error) {
    if (error instanceof ScimError) return errorResponse(error);
    if (error instanceof WorkspaceError) return errorResponse(new ScimError(400, error.message, "mutability"));
    console.error("SCIM request failed", error);
    return errorResponse(new ScimError(500, "Something went wrong."));
  }
}

/** For the settings box: how many people SCIM manages in the workspace. */
export async function scimManagedCount(workspaceId: string) {
  const [row] = await db.select({ n: count() }).from(scimIdentity).where(eq(scimIdentity.workspaceId, workspaceId));
  return row?.n ?? 0;
}

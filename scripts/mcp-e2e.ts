/**
 * End-to-end check of the remote MCP server against a running app (`pnpm dev`):
 * discovery, DCR, sign-in continuation, consent (deny, read-only, full), authorization
 * code + PKCE with `resource`, refresh, MCP tool calls on both protocol eras, scope
 * step-up for writes, and revocation.
 *
 *   pnpm tsx scripts/mcp-e2e.ts
 *
 * Env: APP_URL (default http://localhost:3000), E2E_EMAIL / E2E_PASSWORD (default test user).
 */
import { createHash, randomBytes } from "node:crypto";

try {
  process.loadEnvFile();
} catch {}

const BASE = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const EMAIL = process.env.E2E_EMAIL ?? "test@example.com";
const PASSWORD = process.env.E2E_PASSWORD ?? "password123";
const REDIRECT_URI = "http://127.0.0.1:33418/callback";
const RESOURCE = `${BASE}/mcp`;
const RUN = Date.now().toString(36);

let passed = 0;
function check(condition: unknown, label: string, detail?: unknown): asserts condition {
  if (!condition) {
    console.error(`FAIL  ${label}`);
    if (detail !== undefined) console.error(typeof detail === "string" ? detail : JSON.stringify(detail, null, 2));
    throw new Error(`Check failed: ${label}`);
  }
  passed++;
  console.log(`ok    ${label}`);
}

const b64url = (buf: Buffer) => buf.toString("base64url");

/** Minimal cookie jar for the Better Auth session. */
class Jar {
  private cookies = new Map<string, string>();
  store(res: Response) {
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(";");
      const eq = pair.indexOf("=");
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      const expired = attrs.some((a) => /max-age=0/i.test(a.trim())) || value === "";
      if (expired) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
  header() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

async function json<T = any>(res: Response): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Expected JSON from ${res.url} (${res.status}): ${text.slice(0, 300)}`);
  }
}

// ---------------------------------------------------------------------------- OAuth

type Client = { client_id: string; client_name: string };
type Tokens = { access_token: string; refresh_token?: string; scope?: string; token_type: string; expires_in: number };

async function discover() {
  const prmRes = await fetch(`${BASE}/.well-known/oauth-protected-resource/mcp`);
  check(prmRes.ok, "protected resource metadata is served");
  const prm = await json(prmRes);
  check(prm.resource === RESOURCE, "PRM names the MCP resource", prm);
  const issuer = new URL(prm.authorization_servers[0]);
  const asRes = await fetch(`${issuer.origin}/.well-known/oauth-authorization-server${issuer.pathname}`);
  check(asRes.ok, "authorization server metadata is served");
  const as = await json(asRes);
  check(as.issuer === issuer.toString().replace(/\/$/, ""), "AS metadata issuer matches PRM", as.issuer);
  check(as.code_challenge_methods_supported?.includes("S256"), "AS supports PKCE S256");
  return as as { issuer: string; authorization_endpoint: string; token_endpoint: string; registration_endpoint: string };
}

async function register(as: Awaited<ReturnType<typeof discover>>, name: string): Promise<Client> {
  const res = await fetch(as.registration_endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: name,
      // Loopback redirects are only accepted for native clients; the MCP SDK infers this too.
      application_type: "native",
      redirect_uris: [REDIRECT_URI],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope: "openid profile offline_access pages:read pages:write notifications:read",
    }),
  });
  const body = await json(res);
  check(res.status === 201 || res.status === 200, `DCR registers public client "${name}"`, body);
  check(!body.client_secret, "public client gets no secret");
  return body;
}

function pkce() {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

function authorizeUrl(as: { authorization_endpoint: string }, client: Client, state: string, challenge: string) {
  const url = new URL(as.authorization_endpoint);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: client.client_id,
    redirect_uri: REDIRECT_URI,
    scope: "openid profile offline_access pages:read pages:write notifications:read",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: RESOURCE,
  }).toString();
  return url.toString();
}

/** What the oauthProviderClient fetch plugin sends: only the signed parameters. */
function signedQuery(pageUrl: string) {
  const params = new URL(pageUrl, BASE).searchParams;
  const names = new Set(params.getAll("ba_param"));
  const out = new URLSearchParams();
  for (const [k, v] of params) if (k === "sig" || k === "ba_param" || names.has(k)) out.append(k, v);
  return out.toString();
}

async function authPost(jar: Jar, path: string, body: unknown) {
  const res = await fetch(`${BASE}/api/auth${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE, cookie: jar.header() },
    body: JSON.stringify(body),
  });
  jar.store(res);
  return res;
}

async function getRedirect(jar: Jar, url: string) {
  const res = await fetch(url, { redirect: "manual", headers: { cookie: jar.header(), accept: "text/html" } });
  jar.store(res);
  // Node fetch always sends `sec-fetch-mode: cors`, so Better Auth answers with the JSON form
  // of a redirect ({ redirect, url }) instead of a 302; accept both.
  if (res.status === 200 && (res.headers.get("content-type") ?? "").includes("application/json")) {
    const body = await json(res);
    check(body.redirect === true && typeof body.url === "string", `GET ${new URL(url).pathname} redirects`, body);
    return new URL(body.url, BASE).toString();
  }
  const location = res.headers.get("location");
  check(res.status >= 300 && res.status < 400 && location, `GET ${new URL(url).pathname} redirects`, {
    status: res.status,
    body: (await res.text()).slice(0, 300),
  });
  return new URL(location, BASE).toString();
}

type Decision = { accept: false } | { accept: true; scope?: string };

/**
 * Runs the browser part of the authorization: authorize → (sign-in) → consent page →
 * decision. Returns the final redirect back to the client.
 */
async function authorize(
  as: Awaited<ReturnType<typeof discover>>,
  jar: Jar,
  client: Client,
  decision: Decision,
  { expectLogin }: { expectLogin: boolean },
) {
  const { verifier, challenge } = pkce();
  const state = b64url(randomBytes(12));
  let next = await getRedirect(jar, authorizeUrl(as, client, state, challenge));

  if (expectLogin) {
    check(new URL(next).pathname === "/sign-in", "authorize without a session redirects to /sign-in", next);
    // The sign-in form posts the signed query; the server answers with where to continue.
    const res = await authPost(jar, "/sign-in/email", { email: EMAIL, password: PASSWORD, oauth_query: signedQuery(next) });
    const body = await json(res);
    check(res.ok && typeof body.url === "string", "sign-in continues the OAuth flow (returns url)", body);
    next = new URL(body.url, BASE).toString();
  }

  check(new URL(next).pathname === "/oauth/consent", "flow reaches the consent page", next);
  const page = await fetch(next, { headers: { cookie: jar.header() } });
  const html = await page.text();
  check(page.ok && html.includes(client.client_name), "consent page renders the client name", page.status);
  check(html.includes("Read pages and databases"), "consent page describes scopes in plain language");
  check(html.includes(EMAIL), "consent page shows the signed-in user");

  const res = await authPost(jar, "/oauth2/consent", { ...decision, oauth_query: signedQuery(next) });
  const body = await json(res);
  check(res.ok && typeof body.url === "string", `consent ${decision.accept ? "accept" : "deny"} returns a redirect`, body);
  const back = new URL(body.url);
  check(back.origin + back.pathname === REDIRECT_URI, "redirect goes back to the client's redirect_uri", body.url);
  check(back.searchParams.get("state") === state, "state round-trips");
  return { back, verifier, state };
}

async function exchange(as: Awaited<ReturnType<typeof discover>>, client: Client, code: string, verifier: string) {
  const res = await fetch(as.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      client_id: client.client_id,
      code_verifier: verifier,
      resource: RESOURCE,
    }),
  });
  const body = await json<Tokens>(res);
  check(res.ok && body.access_token, "authorization code exchanges for tokens", body);
  return body;
}

function decodeJwt(token: string) {
  const [, payload] = token.split(".");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
}

// ---------------------------------------------------------------------------- MCP

type RpcResult = { status: number; headers: Headers; message?: any };

async function rpc(token: string | null, body: unknown, extraHeaders: Record<string, string> = {}): Promise<RpcResult> {
  const res = await fetch(RESOURCE, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!text) return { status: res.status, headers: res.headers };
  const id = (body as { id?: unknown }).id;
  if ((res.headers.get("content-type") ?? "").includes("text/event-stream")) {
    const messages = text
      .split(/\r?\n/)
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trim())
      .filter(Boolean)
      .map((d) => JSON.parse(d));
    return { status: res.status, headers: res.headers, message: messages.find((m) => m.id === id) ?? messages.at(-1) };
  }
  return { status: res.status, headers: res.headers, message: JSON.parse(text) };
}

class LegacySession {
  private nextId = 1;
  constructor(private token: string) {}
  async init() {
    const r = await rpc(this.token, {
      jsonrpc: "2.0",
      id: this.nextId++,
      method: "initialize",
      params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "esionage-e2e", version: "1.0.0" } },
    });
    check(r.status === 200 && r.message?.result?.serverInfo?.name === "esionage", "legacy initialize succeeds", r);
    const n = await rpc(this.token, { jsonrpc: "2.0", method: "notifications/initialized" }, { "mcp-protocol-version": "2025-11-25" });
    check(n.status === 202 || n.status === 200, "initialized notification accepted", n.status);
    return r.message.result;
  }
  request(method: string, params: unknown) {
    return rpc(this.token, { jsonrpc: "2.0", id: this.nextId++, method, params }, { "mcp-protocol-version": "2025-11-25" });
  }
  async call(name: string, args: Record<string, unknown>) {
    const r = await this.request("tools/call", { name, arguments: args });
    if (r.status !== 200 || !r.message?.result) throw new Error(`tools/call ${name} failed: ${JSON.stringify(r)}`);
    const result = r.message.result as { isError?: boolean; content: { type: string; text: string }[] };
    const text = result.content?.[0]?.text ?? "";
    let data: any = text;
    try {
      data = JSON.parse(text);
    } catch {}
    return { isError: Boolean(result.isError), data, text };
  }
  async ok(name: string, args: Record<string, unknown>) {
    const r = await this.call(name, args);
    check(!r.isError, `tool ${name} succeeds`, r.text);
    return r.data;
  }
}

// ---------------------------------------------------------------------------- run

async function main() {
  console.log(`MCP e2e against ${BASE} (run ${RUN})\n`);

  // Unauthenticated access is challenged with a pointer to the resource metadata.
  const unauth = await rpc(null, { jsonrpc: "2.0", id: 1, method: "tools/list" });
  const challenge = unauth.headers.get("www-authenticate") ?? "";
  check(unauth.status === 401, "unauthenticated POST /mcp → 401", unauth.status);
  check(
    challenge.includes(`resource_metadata="${BASE}/.well-known/oauth-protected-resource/mcp"`),
    "WWW-Authenticate points at the protected resource metadata",
    challenge,
  );
  const bogus = await rpc("not-a-token", { jsonrpc: "2.0", id: 1, method: "tools/list" });
  check(bogus.status === 401, "invalid bearer token → 401", bogus.status);

  const as = await discover();
  const jar = new Jar();

  // Full access client: sign in during the flow, then allow everything.
  const full = await register(as, `e2e full ${RUN}`);
  const a = await authorize(as, jar, full, { accept: true }, { expectLogin: true });
  const code = a.back.searchParams.get("code");
  check(code && a.back.searchParams.get("iss") === as.issuer, "redirect carries code and iss", a.back.toString());
  const tokens = await exchange(as, full, code, a.verifier);
  const claims = decodeJwt(tokens.access_token);
  check(claims.aud === RESOURCE || claims.aud?.includes?.(RESOURCE), "access token is audience-bound to /mcp", claims.aud);
  check(String(claims.scope).split(" ").includes("pages:write"), "token carries pages:write", claims.scope);
  check(claims.azp === full.client_id, "token names the client (azp)");
  check(tokens.refresh_token, "offline_access yields a refresh token");

  // Refresh keeps the audience.
  const refreshRes = await fetch(as.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token!,
      client_id: full.client_id,
      resource: RESOURCE,
    }),
  });
  const refreshed = await json<Tokens>(refreshRes);
  check(refreshRes.ok && refreshed.access_token, "refresh_token grant works", refreshed);

  // ---- MCP over the 2025 (stateless) protocol
  const mcp = new LegacySession(refreshed.access_token);
  const init = await mcp.init();
  check(typeof init.instructions === "string" && init.instructions.includes("snapshot"), "server sends instructions");
  const list = await mcp.request("tools/list", {});
  const toolNames: string[] = list.message?.result?.tools?.map((t: { name: string }) => t.name) ?? [];
  const expected = [
    "list_workspaces", "search", "list_pages", "get_page", "create_page", "update_page", "archive_page",
    "get_database", "query_database", "create_database_row", "create_database_rows", "update_database_row", "create_database", "add_database_property",
    "update_database_property", "delete_database_property", "create_database_view", "update_database_view", "move_page",
    "list_recent_pages", "list_users", "list_trash", "restore_page", "list_page_history", "get_page_version", "restore_page_version",
    "list_notifications",
  ];
  check(expected.every((t) => toolNames.includes(t)), "tools/list returns every tool", toolNames);
  const getPageTool = list.message.result.tools.find((t: { name: string }) => t.name === "get_page");
  check(getPageTool.annotations?.readOnlyHint === true, "read tools are annotated readOnlyHint");

  const { workspaces } = await mcp.ok("list_workspaces", {});
  check(workspaces.length > 0, "user has at least one workspace");
  const ws = workspaces[0].id as string;
  const inbox = await mcp.ok("list_notifications", { workspace_id: ws, unread_only: true });
  check(Array.isArray(inbox.notifications), "list_notifications reads the inbox with notifications:read", inbox);

  const root = await mcp.ok("create_page", {
    workspace_id: ws,
    title: `MCP e2e ${RUN}`,
    markdown: `# Hello from MCP\n\nFirst paragraph with token zq${RUN}.`,
  });
  check(root.url === `${BASE}/w/${ws}/p/${root.id}`, "create_page returns the page link", root);

  let page = await mcp.ok("get_page", { page_id: root.id });
  check(page.markdown.includes("First paragraph"), "get_page returns the markdown body", page.markdown);
  check(page.path.endsWith(`MCP e2e ${RUN}`), "get_page returns the breadcrumb path", page.path);

  await mcp.ok("update_page", { page_id: root.id, markdown: "## Appended section\n\n- one\n- two", mode: "append" });
  page = await mcp.ok("get_page", { page_id: root.id });
  check(page.markdown.includes("First paragraph") && page.markdown.includes("Appended section"), "append keeps and extends the body", page.markdown);

  await mcp.ok("update_page", { page_id: root.id, markdown: "Replaced body.", mode: "replace", title: `MCP e2e ${RUN} renamed` });
  page = await mcp.ok("get_page", { page_id: root.id });
  check(page.markdown.trim() === "Replaced body.", "replace overwrites the body", page.markdown);
  check(page.title === `MCP e2e ${RUN} renamed`, "update_page renames", page.title);

  const hits = await mcp.ok("search", { query: `MCP e2e ${RUN}`, workspace_id: ws });
  check(hits.results.some((h: { id: string }) => h.id === root.id), "search finds the page", hits);

  const child = await mcp.ok("create_page", { parent_id: root.id, title: "Child page", icon: "📄" });
  const listed = await mcp.ok("list_pages", { workspace_id: ws, parent_id: root.id });
  check(listed.pages.some((p: { id: string }) => p.id === child.id), "list_pages lists the child");

  // ---- databases
  const dbPage = await mcp.ok("create_database", { parent_id: root.id, title: "Tasks" });
  check(dbPage.properties.some((p: { name: string }) => p.name === "Status"), "create_database has default Status", dbPage);
  await mcp.ok("add_database_property", { database_id: dbPage.id, name: "Estimate", type: "number" });
  await mcp.ok("add_database_property", { database_id: dbPage.id, name: "Priority", type: "select", options: ["High", "Low"] });
  const dup = await mcp.call("add_database_property", { database_id: dbPage.id, name: "priority", type: "text" });
  check(dup.isError && /already exists/.test(dup.text), "duplicate property name is a tool error", dup.text);

  const schema = await mcp.ok("get_database", { database_id: dbPage.id });
  const priority = schema.properties.find((p: { name: string }) => p.name === "Priority");
  check(priority?.options?.join(",") === "High,Low", "get_database lists option names", schema);

  const rowA = await mcp.ok("create_database_row", {
    database_id: dbPage.id,
    title: "Row A",
    properties: { Status: "In progress", Estimate: 3 },
    markdown: "Row body text.",
  });
  check(rowA.properties.Status === "In progress" && rowA.properties.Estimate === 3, "create_database_row stores display values", rowA);
  const rowB = await mcp.ok("create_database_row", {
    database_id: dbPage.id,
    title: "Row B",
    properties: { status: "Done", Estimate: 8, Priority: "High" },
  });

  const bad = await mcp.call("create_database_row", { database_id: dbPage.id, title: "Bad", properties: { Colour: "red" } });
  check(bad.isError && bad.text.includes("Unknown property") && bad.text.includes("get_database"), "unknown property → helpful tool error", bad.text);
  const badOption = await mcp.call("create_database_row", { database_id: dbPage.id, title: "Bad", properties: { Status: "Blocked" } });
  check(badOption.isError && badOption.text.includes("not an option"), "unknown option → helpful tool error", badOption.text);

  const done = await mcp.ok("query_database", { database_id: dbPage.id, filters: [{ property: "Status", op: "equals", value: "Done" }] });
  check(done.total === 1 && done.rows[0].id === rowB.id && done.rows[0].properties.Status === "Done", "query_database filters by option name", done);
  const sorted = await mcp.ok("query_database", { database_id: dbPage.id, sorts: [{ property: "Estimate", direction: "desc" }] });
  check(sorted.rows[0].id === rowB.id && sorted.rows[1].id === rowA.id, "query_database sorts", sorted);
  const big = await mcp.ok("query_database", { database_id: dbPage.id, filters: [{ property: "Estimate", op: "gt", value: 5 }] });
  check(big.total === 1 && big.rows[0].id === rowB.id, "query_database numeric gt", big);

  const updated = await mcp.ok("update_database_row", { row_id: rowA.id, title: "Row A renamed", properties: { Status: "Done", Priority: "Low" } });
  check(updated.properties.Status === "Done" && updated.properties.Priority === "Low" && updated.title === "Row A renamed", "update_database_row updates", updated);
  const rowPage = await mcp.ok("get_page", { page_id: rowA.id });
  check(rowPage.properties?.Priority === "Low" && rowPage.markdown.includes("Row body text"), "get_page shows row properties and body", rowPage);
  const notRow = await mcp.call("update_database_row", { row_id: root.id, properties: { Status: "Done" } });
  check(notRow.isError && notRow.text.includes("not a database row"), "update_database_row rejects regular pages", notRow.text);

  const missing = await mcp.call("get_page", { page_id: "00000000-0000-0000-0000-000000000000" });
  check(missing.isError && missing.text.includes("Not found"), "unknown id → tool error, not a 500", missing.text);

  // ---- moving pages
  const moved = await mcp.ok("create_page", { workspace_id: ws, title: `MCP e2e move ${RUN}` });
  await mcp.ok("move_page", { page_id: moved.id, parent_id: child.id });
  const movedPage = await mcp.ok("get_page", { page_id: moved.id });
  check(movedPage.parent_id === child.id, "move_page nests the page", movedPage);
  const cycle = await mcp.call("move_page", { page_id: root.id, parent_id: moved.id });
  check(cycle.isError && cycle.text.includes("inside itself"), "move_page refuses cycles", cycle.text);
  const asRow = await mcp.ok("move_page", { page_id: moved.id, parent_id: dbPage.id });
  check(asRow.note?.includes("row"), "moving into a database says the page became a row", asRow);
  const rowsNow = await mcp.ok("query_database", { database_id: dbPage.id });
  check(rowsNow.rows.some((r: { id: string }) => r.id === moved.id), "the moved page shows up as a row", rowsNow);
  await mcp.ok("move_page", { page_id: moved.id, parent_id: root.id });

  const recent = await mcp.ok("list_recent_pages", { workspace_id: ws, limit: 50 });
  check(recent.pages.some((p: { id: string }) => p.id === moved.id), "list_recent_pages lists fresh edits", recent);
  const members = await mcp.ok("list_users", { workspace_id: ws });
  check(members.users.some((u: { is_you: boolean; email: string }) => u.is_you && u.email === EMAIL), "list_users includes the connected user", members);

  // ---- editing properties and views
  const renamedProp = await mcp.ok("update_database_property", {
    database_id: dbPage.id,
    property: "Priority",
    name: "Urgency",
    rename_options: [{ from: "High", to: "Urgent" }],
    add_options: ["Medium"],
  });
  check(renamedProp.property.name === "Urgency" && renamedProp.property.options.join(",") === "Urgent,Low,Medium", "update_database_property renames and adds options", renamedProp);
  const rowBAfter = await mcp.ok("get_page", { page_id: rowB.id });
  check(rowBAfter.properties.Urgency === "Urgent", "a renamed option stays on its rows", rowBAfter.properties);
  await mcp.ok("delete_database_property", { database_id: dbPage.id, property: "estimate" });
  const schemaAfter = await mcp.ok("get_database", { database_id: dbPage.id });
  check(!schemaAfter.properties.some((p: { name: string }) => p.name === "Estimate"), "delete_database_property removes the column", schemaAfter);

  const board = await mcp.ok("create_database_view", {
    database_id: dbPage.id,
    name: "Urgent board",
    type: "board",
    group_by: "Status",
    filters: [{ property: "Urgency", op: "equals", value: "Urgent" }],
  });
  check(board.group_by === "Status" && board.filters?.[0]?.value === "Urgent", "create_database_view stores grouping and filters", board);
  const viaView = await mcp.ok("query_database", { database_id: dbPage.id, view_id: board.id });
  check(viaView.total === 1 && viaView.rows[0].id === rowB.id, "the new view filters rows", viaView);
  const boardUpdated = await mcp.ok("update_database_view", { database_id: dbPage.id, view_id: board.id, name: "Board", filters: [] });
  check(boardUpdated.name === "Board" && !boardUpdated.filters && boardUpdated.group_by === "Status", "update_database_view clears filters and keeps grouping", boardUpdated);
  const tagBoard = await mcp.ok("create_database_view", { database_id: dbPage.id, name: "By tag", type: "board", group_by: "Tags" });
  check(tagBoard.group_by === "Tags", "boards group by multi-select properties too", tagBoard);
  const groupedTable = await mcp.ok("create_database_view", { database_id: dbPage.id, name: "Grouped", group_by: "Status", hide_empty_groups: true });
  check(groupedTable.type === "table" && groupedTable.group_by === "Status" && groupedTable.hide_empty_groups === true, "tables group by a property", groupedTable);
  const calendarGroup = await mcp.call("create_database_view", { database_id: dbPage.id, name: "Bad", type: "calendar", group_by: "Tags" });
  check(calendarGroup.isError && calendarGroup.text.includes("only applies to board and table views"), "calendars refuse grouping", calendarGroup.text);

  // ---- "created by": filled in with each row's creator, filterable on "me", read-only
  await mcp.ok("add_database_property", { database_id: dbPage.id, name: "Created by", type: "created_by" });
  const mineOnly = await mcp.ok("query_database", {
    database_id: dbPage.id,
    filters: [{ property: "Created by", op: "contains", value: "me" }],
    sorts: [{ property: "Created by" }],
  });
  check(
    mineOnly.total > 0 && mineOnly.rows.every((r: { properties: Record<string, { name: string }[]> }) => r.properties["Created by"]?.[0]?.name),
    "created_by shows the creator's name, filters on me and sorts",
    mineOnly,
  );
  const writeCreator = await mcp.call("update_database_row", { row_id: rowB.id, properties: { "Created by": ["me"] } });
  check(writeCreator.isError && writeCreator.text.includes("set automatically"), "created_by can't be written", writeCreator.text);

  // ---- relations (two-way sync) and calendar views
  const customers = await mcp.ok("create_database", { parent_id: root.id, title: "Customers" });
  const acme = await mcp.ok("create_database_row", { database_id: customers.id, title: "Acme" });
  const globex = await mcp.ok("create_database_row", { database_id: customers.id, title: "Globex" });
  const relProp = await mcp.ok("add_database_property", {
    database_id: dbPage.id,
    name: "Customer",
    type: "relation",
    related_database_id: customers.id,
    two_way: true,
    paired_property_name: "Jobs",
  });
  check(relProp.property.two_way && relProp.property.paired_property === "Jobs", "add_database_property creates a two-way relation", relProp);
  const customerSchema = await mcp.ok("get_database", { database_id: customers.id });
  check(
    customerSchema.properties.some((p: { name: string; type: string }) => p.name === "Jobs" && p.type === "relation"),
    "the related database gets the paired property",
    customerSchema.properties,
  );
  const job = await mcp.ok("create_database_row", { database_id: dbPage.id, title: "Install", properties: { Customer: ["acme"] } });
  check(job.properties.Customer?.[0]?.id === acme.id, "relation values resolve row titles to ids", job.properties);
  let acmePage = await mcp.ok("get_page", { page_id: acme.id });
  check(acmePage.properties.Jobs?.[0]?.id === job.id, "creating a row mirrors the link on the related row", acmePage.properties);
  await mcp.ok("update_database_row", { row_id: job.id, properties: { Customer: [globex.id] } });
  acmePage = await mcp.ok("get_page", { page_id: acme.id });
  const globexPage = await mcp.ok("get_page", { page_id: globex.id });
  check(!acmePage.properties.Jobs && globexPage.properties.Jobs?.[0]?.id === job.id, "changing a relation moves the mirrored link", {
    acme: acmePage.properties,
    globex: globexPage.properties,
  });
  const byCustomer = await mcp.ok("query_database", {
    database_id: dbPage.id,
    filters: [{ property: "Customer", op: "contains", value: "Globex" }],
  });
  check(byCustomer.total === 1 && byCustomer.rows[0].id === job.id, "query_database filters by related row title", byCustomer);
  const rowsBefore = (await mcp.ok("get_database", { database_id: dbPage.id })).row_count;
  const badBatch = await mcp.call("create_database_rows", {
    database_id: dbPage.id,
    rows: [{ title: "Survey" }, { title: "Repair", properties: { Customer: ["Nobody"] } }],
  });
  const rowsAfterBad = (await mcp.ok("get_database", { database_id: dbPage.id })).row_count;
  check(
    badBatch.isError && badBatch.text.includes("Row 2") && rowsAfterBad === rowsBefore,
    "create_database_rows names the bad row and creates nothing",
    { text: badBatch.text, rowsBefore, rowsAfterBad },
  );
  const batch = await mcp.ok("create_database_rows", {
    database_id: dbPage.id,
    rows: [
      { title: "Survey", properties: { Customer: ["Acme"], Status: "Done" } },
      { title: "Repair", properties: { Customer: [globex.id] }, markdown: "Compressor noise" },
    ],
  });
  check(batch.created === 2 && batch.rows.map((r: { title: string }) => r.title).join() === "Survey,Repair", "create_database_rows adds rows in order", batch);
  const [survey, repair] = batch.rows as { id: string }[];
  acmePage = await mcp.ok("get_page", { page_id: acme.id });
  const globexAfterBatch = await mcp.ok("get_page", { page_id: globex.id });
  check(
    acmePage.properties.Jobs?.[0]?.id === survey.id &&
      globexAfterBatch.properties.Jobs?.map((j: { id: string }) => j.id).sort().join() === [job.id, repair.id].sort().join(),
    "create_database_rows mirrors two-way relations",
    { acme: acmePage.properties, globex: globexAfterBatch.properties },
  );
  const repairPage = await mcp.ok("get_page", { page_id: repair.id });
  check(repairPage.markdown.includes("Compressor noise"), "create_database_rows writes row bodies", repairPage.markdown);
  const badLink = await mcp.call("update_database_row", { row_id: job.id, properties: { Customer: ["Nobody"] } });
  check(badLink.isError && badLink.text.includes("not a row"), "relations reject rows outside the related database", badLink.text);
  await mcp.ok("delete_database_property", { database_id: dbPage.id, property: "Customer" });
  const afterUnpair = await mcp.ok("get_database", { database_id: customers.id });
  const jobs = afterUnpair.properties.find((p: { name: string }) => p.name === "Jobs");
  check(jobs && jobs.two_way === false, "deleting one side leaves the other as a one-way relation", afterUnpair.properties);

  await mcp.ok("add_database_property", { database_id: dbPage.id, name: "Due", type: "date" });
  const calendar = await mcp.ok("create_database_view", { database_id: dbPage.id, name: "Calendar", type: "calendar" });
  check(calendar.type === "calendar" && calendar.date_by === "Due", "calendar views default to the first date property", calendar);
  const calendarBad = await mcp.call("update_database_view", { database_id: dbPage.id, view_id: calendar.id, date_by: "Status" });
  check(calendarBad.isError && calendarBad.text.includes("date property"), "calendars refuse non-date properties", calendarBad.text);

  // ---- history: read an old version and bring it back
  const history = await mcp.ok("list_page_history", { page_id: root.id });
  check(history.versions.some((v: { by: string | null }) => v.by?.includes(" via ")), "list_page_history names the MCP client", history);
  const oldest = history.versions.at(-1);
  const version = await mcp.ok("get_page_version", { version_id: oldest.id });
  check(version.markdown.includes("First paragraph") && version.page_id === root.id, "get_page_version returns the old body", version);
  await mcp.ok("restore_page_version", { version_id: oldest.id });
  page = await mcp.ok("get_page", { page_id: root.id });
  check(page.markdown.includes("First paragraph") && !page.markdown.includes("Replaced body"), "restore_page_version brings the old body back", page.markdown);

  // ---- snapshots: every agent content write is preceded by a history snapshot
  const { db } = await import("@/db");
  const { sql } = await import("drizzle-orm");
  const snaps = await db.execute<{ count: number }>(
    sql`select count(*)::int as count from page_snapshot where page_id = ${root.id} and reason = 'before_mcp_write' and oauth_client_id = ${full.client_id}`,
  );
  check(snaps[0].count >= 2, "content writes took before_mcp_write snapshots attributed to the client", snaps[0]);

  // ---- 2026-07-28 protocol (per-request envelope, no initialize)
  const modernMeta = {
    "io.modelcontextprotocol/protocolVersion": "2026-07-28",
    "io.modelcontextprotocol/clientCapabilities": {},
    "io.modelcontextprotocol/clientInfo": { name: "esionage-e2e", version: "1.0.0" },
  };
  const modernHeaders = { "mcp-protocol-version": "2026-07-28" };
  const modernList = await rpc(
    refreshed.access_token,
    { jsonrpc: "2.0", id: 1, method: "tools/list", params: { _meta: modernMeta } },
    { ...modernHeaders, "mcp-method": "tools/list" },
  );
  check(modernList.status === 200 && modernList.message?.result?.tools?.length >= expected.length, "2026-07-28 tools/list works", modernList);
  const modernCall = await rpc(
    refreshed.access_token,
    { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "list_workspaces", arguments: {}, _meta: modernMeta } },
    { ...modernHeaders, "mcp-method": "tools/call", "mcp-name": "list_workspaces" },
  );
  check(modernCall.status === 200 && !modernCall.message?.result?.isError, "2026-07-28 tools/call works", modernCall);

  // ---- read-only client: deny once, then allow without pages:write
  const ro = await register(as, `e2e read-only ${RUN}`);
  const denied = await authorize(as, jar, ro, { accept: false }, { expectLogin: false });
  check(denied.back.searchParams.get("error") === "access_denied", "deny → access_denied", denied.back.toString());
  const b = await authorize(as, jar, ro, { accept: true, scope: "openid profile offline_access pages:read" }, { expectLogin: false });
  const roTokens = await exchange(as, ro, b.back.searchParams.get("code")!, b.verifier);
  check(!String(decodeJwt(roTokens.access_token).scope).split(" ").includes("pages:write"), "read-only token lacks pages:write");
  const roMcp = new LegacySession(roTokens.access_token);
  await roMcp.init();
  const roRead = await roMcp.call("get_page", { page_id: root.id });
  check(!roRead.isError, "read-only token can read");
  const roWrite = await roMcp.request("tools/call", { name: "create_page", arguments: { workspace_id: ws, title: "Should not exist" } });
  const stepUp = roWrite.headers.get("www-authenticate") ?? "";
  check(roWrite.status === 403 && stepUp.includes('error="insufficient_scope"') && stepUp.includes("pages:write"), "write with read-only token → 403 insufficient_scope", { status: roWrite.status, stepUp });
  const roModern = await rpc(
    roTokens.access_token,
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "archive_page", arguments: { page_id: root.id }, _meta: modernMeta } },
    { ...modernHeaders, "mcp-method": "tools/call", "mcp-name": "archive_page" },
  );
  check(roModern.status === 403, "write with read-only token on 2026-07-28 → 403", roModern.status);
  const roInbox = await roMcp.request("tools/call", { name: "list_notifications", arguments: {} });
  const inboxStepUp = roInbox.headers.get("www-authenticate") ?? "";
  check(
    roInbox.status === 403 && inboxStepUp.includes('error="insufficient_scope"') && inboxStepUp.includes("notifications:read"),
    "list_notifications without notifications:read → 403 insufficient_scope",
    { status: roInbox.status, inboxStepUp },
  );
  const stillThere = await mcp.ok("get_page", { page_id: root.id });
  check(!stillThere.in_trash, "read-only token did not change anything");

  // ---- cleanup through the tools, then revoke both apps
  const archived = await mcp.ok("archive_page", { page_id: root.id });
  check(archived.in_trash, "archive_page moves the tree to the trash");
  const childAfter = await mcp.ok("get_page", { page_id: child.id });
  check(childAfter.in_trash, "archive_page includes sub-pages");
  const trash = await mcp.ok("list_trash", { workspace_id: ws });
  check(
    trash.pages.some((p: { id: string }) => p.id === root.id) && !trash.pages.some((p: { id: string }) => p.id === child.id),
    "list_trash lists the trashed root, not its sub-pages",
    trash,
  );
  const restored = await mcp.ok("restore_page", { page_id: child.id });
  check(restored.parent_id === null && restored.note?.includes("top level"), "restore_page lifts a page whose parent is still trashed", restored);
  const restoredPage = await mcp.ok("get_page", { page_id: child.id });
  check(!restoredPage.in_trash, "restore_page takes the page out of the trash");
  await mcp.ok("archive_page", { page_id: child.id });

  const { revokeConnectedApp, listConnectedApps } = await import("@/server/mcp/grants");
  const { user } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const [me] = await db.select({ id: user.id }).from(user).where(eq(user.email, EMAIL));
  const apps = await listConnectedApps(me.id);
  check(apps.some((x) => x.clientId === full.client_id) && apps.some((x) => x.clientId === ro.client_id), "connected apps lists both clients");
  await revokeConnectedApp(me.id, full.client_id);
  await revokeConnectedApp(me.id, ro.client_id);
  const afterRevoke = await rpc(refreshed.access_token, { jsonrpc: "2.0", id: 9, method: "tools/list" }, { "mcp-protocol-version": "2025-11-25" });
  check(afterRevoke.status === 401 && (afterRevoke.headers.get("www-authenticate") ?? "").includes("invalid_token"), "revoked app's access token → 401", afterRevoke.status);
  const refreshAfter = await fetch(as.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshed.refresh_token!, client_id: full.client_id, resource: RESOURCE }),
  });
  check(!refreshAfter.ok, "revoked app's refresh token is rejected", refreshAfter.status);
  const appsAfter = await listConnectedApps(me.id);
  check(!appsAfter.some((x) => x.clientId === full.client_id || x.clientId === ro.client_id), "revoked apps disappear from connected apps");

  // The e2e clients are throwaway; drop them so they do not pile up.
  const { oauthClient } = await import("@/db/schema");
  const { inArray } = await import("drizzle-orm");
  await db.delete(oauthClient).where(inArray(oauthClient.clientId, [full.client_id, ro.client_id]));

  console.log(`\nAll ${passed} checks passed.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(`\n${passed} checks passed before the failure.`);
    console.error(error);
    process.exit(1);
  });

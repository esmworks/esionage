/**
 * End-to-end check of two-step verification against a running app: turning on the authenticator
 * app (codes computed here, playing the app), the sign-in challenge, recovery codes (one use
 * each), trusted devices, an MCP app's authorization continuing only after the code, turning it
 * off, and a workspace's "require two-step verification"
 * policy (the owner can't turn it on unverified, members without it land on the set-up page,
 * outsiders learn nothing), and `pnpm auth:reset-2fa`. Creates its own @example.test users and
 * deletes them afterwards.
 *
 * Passkeys need a real authenticator (WebAuthn), so they are covered by the unit tests of the
 * server wiring (src/lib/auth-security.test.ts), not here.
 *
 *   APP_URL=http://localhost:4100 pnpm tsx scripts/two-factor-e2e.ts
 *
 * Env: APP_URL (default http://localhost:3000), DATABASE_URL (read from .env when present).
 */
import { execFileSync } from "node:child_process";

try {
  process.loadEnvFile();
} catch {}

// Imported after .env is loaded: the database client reads DATABASE_URL when it is created.
const { eq, inArray } = await import("drizzle-orm");
const { db } = await import("@/db");
const { oauthClient, user, workspace, workspaceMember } = await import("@/db/schema");
const { updateWorkspaceSettings, WorkspaceError } = await import("@/server/workspaces");
const { totpCode, totpKeyFromUri } = await import("@/lib/totp");

const BASE = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const RUN = Date.now().toString(36);
const PASSWORD = "two-factor-e2e-123";
const emailOf = (who: string) => `2fa-${who}-${RUN}@example.test`;

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

/** The cookies of one browser. */
class Jar {
  private cookies = new Map<string, string>();
  store(res: Response) {
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(";");
      const eq = pair.indexOf("=");
      const value = pair.slice(eq + 1).trim();
      if (value && !/max-age=0/i.test(line)) this.cookies.set(pair.slice(0, eq).trim(), value);
      else this.cookies.delete(pair.slice(0, eq).trim());
    }
  }
  has(name: string) {
    return [...this.cookies.keys()].some((key) => key.endsWith(name));
  }
  header() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

async function authPost(path: string, body: unknown, jar: Jar) {
  const res = await fetch(`${BASE}/api/auth${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE, cookie: jar.header() },
    body: JSON.stringify(body),
  });
  jar.store(res);
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
}

type SessionBody = { user: { id: string; email: string; twoFactorEnabled?: boolean }; session: { authMethod?: string } };
async function sessionOf(jar: Jar) {
  const res = await fetch(`${BASE}/api/auth/get-session`, { headers: { cookie: jar.header() } });
  return (await res.json().catch(() => null)) as SessionBody | null;
}

/** An app page as a browser would open it, without following redirects. */
async function open(path: string, jar: Jar) {
  const res = await fetch(`${BASE}${path}`, { headers: { cookie: jar.header(), accept: "text/html" }, redirect: "manual" });
  return { status: res.status, location: res.headers.get("location"), text: res.status === 200 ? await res.text() : "" };
}

/** A code the app would show right now; waits out the last seconds of a period so it stays valid. */
async function codeFor(key: Uint8Array) {
  if (Date.now() % 30_000 > 27_000) await new Promise((r) => setTimeout(r, 3_500));
  return totpCode(key);
}
const wrongCode = (key: Uint8Array) => (totpCode(key) === "000000" ? "111111" : "000000");

const userIds: string[] = [];
const workspaceIds: string[] = [];
const clientIds: string[] = [];

async function signUp(who: string) {
  const jar = new Jar();
  const res = await authPost("/sign-up/email", { name: `2FA ${who}`, email: emailOf(who), password: PASSWORD }, jar);
  check(res.status === 200, `sign up ${who}`, res.body);
  const id = (await sessionOf(jar))!.user.id;
  userIds.push(id);
  const [personal] = await db.select({ id: workspaceMember.workspaceId }).from(workspaceMember).where(eq(workspaceMember.userId, id));
  if (personal) workspaceIds.push(personal.id);
  return { jar, id, workspaceId: personal?.id };
}

async function signIn(who: string, jar = new Jar()) {
  const res = await authPost("/sign-in/email", { email: emailOf(who), password: PASSWORD }, jar);
  return { ...res, jar };
}

/** Turns on the authenticator app for a signed-in browser; returns the key and recovery codes. */
async function enableTwoFactor(jar: Jar) {
  const enable = await authPost("/two-factor/enable", { password: PASSWORD }, jar);
  check(enable.status === 200 && enable.body?.totpURI?.startsWith("otpauth://totp/"), "enable returns an authenticator URI", enable.body);
  const key = totpKeyFromUri(enable.body.totpURI);
  const codes: string[] = enable.body.backupCodes;
  const verify = await authPost("/two-factor/verify-totp", { code: await codeFor(key) }, jar);
  check(verify.status === 200, "the first code from the app turns it on", verify.body);
  return { key, codes };
}

async function main() {
  // ── Turning it on ───────────────────────────────────────────────────────────────────────
  const owner = await signUp("owner");
  check(owner.workspaceId, "sign-up made a personal workspace", owner);

  const wrongPassword = await authPost("/two-factor/enable", { password: "not-the-password" }, owner.jar);
  check(wrongPassword.status === 400 && wrongPassword.body?.code === "INVALID_PASSWORD", "enabling asks for the right password", wrongPassword.body);

  const halfway = await authPost("/two-factor/enable", { password: PASSWORD }, owner.jar);
  check(halfway.status === 200, "enable starts the set-up", halfway.body);
  check((await sessionOf(owner.jar))?.user.twoFactorEnabled === false, "…but it stays off until a code proves the app works");
  const badFirst = await authPost("/two-factor/verify-totp", { code: wrongCode(totpKeyFromUri(halfway.body.totpURI)) }, owner.jar);
  check(badFirst.status === 401, "a wrong first code doesn't turn it on", badFirst.body);

  const { key, codes } = await enableTwoFactor(owner.jar);
  check(codes.length === 10 && new Set(codes).size === 10, "ten distinct recovery codes come with it", codes);
  const after = await sessionOf(owner.jar);
  check(after?.user.twoFactorEnabled === true, "the session now shows two-step verification on", after);
  check(after?.session.authMethod === "password", "the swapped session keeps how it signed in", after?.session);

  // ── Signing in ──────────────────────────────────────────────────────────────────────────
  const first = await signIn("owner");
  check(first.status === 200 && first.body?.twoFactorRedirect === true, "the right password alone doesn't sign in", first.body);
  check((await sessionOf(first.jar)) === null, "…and leaves no session behind");
  check(first.jar.has("two_factor"), "…only a short-lived pending sign-in cookie");

  const wrong = await authPost("/two-factor/verify-totp", { code: wrongCode(key) }, first.jar);
  check(wrong.status === 401 && wrong.body?.code === "INVALID_CODE", "a wrong code is refused", wrong.body);
  const right = await authPost("/two-factor/verify-totp", { code: await codeFor(key) }, first.jar);
  check(right.status === 200, "the code from the app signs in", right.body);
  const signedIn = await sessionOf(first.jar);
  check(signedIn?.user.email === emailOf("owner") && signedIn.session.authMethod === "totp", "…with a session marked as two-step", signedIn);

  const noChallenge = await authPost("/two-factor/verify-totp", { code: await codeFor(key) }, new Jar());
  check(noChallenge.status === 401, "a code without a pending sign-in does nothing", noChallenge.body);

  // Recovery codes work once.
  const lost = await signIn("owner");
  const recovery = await authPost("/two-factor/verify-backup-code", { code: codes[0] }, lost.jar);
  check(recovery.status === 200 && (await sessionOf(lost.jar))?.session.authMethod === "recovery-code", "a recovery code signs in", recovery.body);
  const again = await signIn("owner");
  const reused = await authPost("/two-factor/verify-backup-code", { code: codes[0] }, again.jar);
  check(reused.status === 401, "the same recovery code doesn't work twice", reused.body);
  check((await sessionOf(again.jar)) === null, "…and signs nobody in");

  // New recovery codes replace the old ones.
  const regenerated = await authPost("/two-factor/generate-backup-codes", { password: PASSWORD }, first.jar);
  check(regenerated.status === 200 && regenerated.body?.backupCodes?.length === 10, "new recovery codes can be made", regenerated.body);
  const stale = await signIn("owner");
  check((await authPost("/two-factor/verify-backup-code", { code: codes[1] }, stale.jar)).status === 401, "…and the old ones stop working");
  const fresh = await authPost("/two-factor/verify-backup-code", { code: regenerated.body.backupCodes[0] }, stale.jar);
  check(fresh.status === 200, "…while the new ones work", fresh.body);

  // A trusted device skips the code for a while.
  const trusted = await signIn("owner");
  await authPost("/two-factor/verify-totp", { code: await codeFor(key), trustDevice: true }, trusted.jar);
  check(trusted.jar.has("trust_device"), "trusting the device sets its cookie");
  const back = await signIn("owner", trusted.jar);
  check(back.status === 200 && !back.body?.twoFactorRedirect && (await sessionOf(back.jar))?.user.email === emailOf("owner"), "a trusted device signs in with the password alone", back.body);

  // ── Connecting an MCP app ───────────────────────────────────────────────────────────────
  // The sign-in page of an OAuth authorization posts the signed query with every step; the code
  // step, not the password, is what continues to the consent page.
  const prm = await (await fetch(`${BASE}/.well-known/oauth-protected-resource/mcp`)).json();
  const issuer = new URL(prm.authorization_servers[0]);
  const as = await (await fetch(`${issuer.origin}/.well-known/oauth-authorization-server${issuer.pathname}`)).json();
  const registered = await fetch(as.registration_endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: `2FA e2e ${RUN}`,
      application_type: "native",
      redirect_uris: ["http://127.0.0.1:33419/callback"],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code"],
      response_types: ["code"],
      scope: "openid pages:read",
    }),
  });
  const client = await registered.json();
  check(registered.ok && client.client_id, "an MCP client registers", client);
  clientIds.push(client.client_id);
  const authorize = new URL(as.authorization_endpoint);
  authorize.search = new URLSearchParams({
    response_type: "code",
    client_id: client.client_id,
    redirect_uri: "http://127.0.0.1:33419/callback",
    scope: "openid pages:read",
    state: RUN,
    code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    code_challenge_method: "S256",
    resource: `${BASE}/mcp`,
  }).toString();
  const oauthJar = new Jar();
  const toSignIn = await fetch(authorize, { redirect: "manual", headers: { accept: "text/html" } });
  const signInPage = new URL(toSignIn.headers.get("location") ?? (await toSignIn.json()).url, BASE);
  check(signInPage.pathname === "/sign-in", "authorizing without a session goes to sign-in", signInPage.toString());
  const names = new Set(signInPage.searchParams.getAll("ba_param"));
  const oauthQuery = new URLSearchParams(
    [...signInPage.searchParams].filter(([k]) => k === "sig" || k === "ba_param" || names.has(k)),
  ).toString();
  const password = await authPost("/sign-in/email", { email: emailOf("owner"), password: PASSWORD, oauth_query: oauthQuery }, oauthJar);
  check(password.body?.twoFactorRedirect === true && !password.body?.url, "the password alone doesn't continue the authorization", password.body);
  const withCode = await authPost("/two-factor/verify-totp", { code: await codeFor(key), oauth_query: oauthQuery }, oauthJar);
  check(
    withCode.status === 200 && new URL(withCode.body?.url ?? "/", BASE).pathname === "/oauth/consent",
    "the code continues to the consent page",
    withCode.body,
  );

  // ── Workspace policy ────────────────────────────────────────────────────────────────────
  const workspaceId = owner.workspaceId!;
  const member = await signUp("member");
  const outsider = await signUp("outsider");
  await db.insert(workspaceMember).values({ workspaceId, userId: member.id, role: "member" });

  try {
    await updateWorkspaceSettings(owner.id, workspaceId, { requireTwoFactor: true }, { strongSession: false });
    check(false, "an owner whose own session isn't two-step can't require it");
  } catch (error) {
    check(error instanceof WorkspaceError && error.code === "twoFactorFirst", "an owner whose own session isn't two-step can't require it", String(error));
  }
  try {
    await updateWorkspaceSettings(member.id, workspaceId, { requireTwoFactor: true }, { strongSession: true });
    check(false, "members can't change the policy");
  } catch (error) {
    check(!(error instanceof WorkspaceError), "members can't change the policy", String(error));
  }
  await updateWorkspaceSettings(owner.id, workspaceId, { requireTwoFactor: true }, { strongSession: true });

  const ownerHome = await open(`/w/${workspaceId}`, first.jar);
  check(ownerHome.status === 200, "the owner, signed in with a code, opens the workspace", ownerHome);

  const gated = await open(`/w/${workspaceId}`, member.jar);
  check(gated.status === 307 && gated.location?.endsWith(`/two-step/${workspaceId}`), "a member without two-step is sent to set it up", gated);
  const gatedSettings = await open(`/w/${workspaceId}/settings?tab=members`, member.jar);
  check(gatedSettings.status === 307 && gatedSettings.location?.endsWith(`/two-step/${workspaceId}`), "…from every page of the workspace", gatedSettings);
  const csv = await fetch(`${BASE}/w/${workspaceId}/settings/members.csv`, { headers: { cookie: member.jar.header() } });
  check(csv.status === 403, "…and its exports", csv.status);
  const gate = await open(`/two-step/${workspaceId}`, member.jar);
  check(gate.status === 200 && gate.text.includes("requires two-step verification"), "the set-up page explains why", gate.status);

  const outsiderHome = await open(`/w/${workspaceId}`, outsider.jar);
  check(outsiderHome.status === 404, "outsiders get not found, not the policy", outsiderHome);
  const outsiderGate = await open(`/two-step/${workspaceId}`, outsider.jar);
  check(outsiderGate.status === 404, "…also on the set-up page", outsiderGate);
  const ownOther = await open(`/w/${outsider.workspaceId}`, outsider.jar);
  check(ownOther.status === 200, "other workspaces are unaffected", ownOther);

  await enableTwoFactor(member.jar);
  const inside = await open(`/w/${workspaceId}`, member.jar);
  check(inside.status === 200, "once set up, the member gets in", inside);
  const gateAfter = await open(`/two-step/${workspaceId}`, member.jar);
  check(gateAfter.status === 307 && gateAfter.location?.endsWith(`/w/${workspaceId}`), "…and the set-up page sends them on", gateAfter);

  // ── Turning it off ──────────────────────────────────────────────────────────────────────
  const refused = await authPost("/two-factor/disable", { password: "not-the-password" }, first.jar);
  check(refused.status === 400 && refused.body?.code === "INVALID_PASSWORD", "turning it off asks for the password", refused.body);
  const disabled = await authPost("/two-factor/disable", { password: PASSWORD }, first.jar);
  check(disabled.status === 200, "the right password turns it off", disabled.body);
  check((await sessionOf(first.jar))?.user.twoFactorEnabled === false, "…and the session shows it off");
  const plain = await signIn("owner");
  check(plain.status === 200 && !plain.body?.twoFactorRedirect && (await sessionOf(plain.jar)) !== null, "the password alone signs in again", plain.body);

  // The owner turned their own verification off: the workspace asks them to set it up again,
  // it doesn't lock them out.
  const ownerGated = await open(`/w/${workspaceId}`, first.jar);
  check(ownerGated.status === 307 && ownerGated.location?.endsWith(`/two-step/${workspaceId}`), "the owner is sent to set it up again", ownerGated);
  const ownerGate = await open(`/two-step/${workspaceId}`, first.jar);
  check(ownerGate.status === 200, "…where they can", ownerGate.status);

  // ── Instance admin reset (lost app and recovery codes) ──────────────────────────────────
  const challenged = await signIn("member");
  check(challenged.body?.twoFactorRedirect === true, "the member's sign-in asks for a code");
  const output = execFileSync("pnpm", ["-s", "tsx", "scripts/reset-two-factor.ts", emailOf("member").toUpperCase()], {
    encoding: "utf8",
  });
  check(output.includes("Two-step verification is off"), "the reset script turns it off by email", output);
  check((await sessionOf(member.jar)) === null, "…signs the member out");
  const afterReset = await signIn("member");
  check(afterReset.status === 200 && !afterReset.body?.twoFactorRedirect, "…and the password alone signs in again", afterReset.body);

  console.log(`\n${passed} checks passed`);
}

try {
  await main();
} finally {
  if (workspaceIds.length) await db.delete(workspace).where(inArray(workspace.id, workspaceIds));
  if (userIds.length) await db.delete(user).where(inArray(user.id, userIds));
  if (clientIds.length) await db.delete(oauthClient).where(inArray(oauthClient.clientId, clientIds));
  await (globalThis as unknown as { __esionageSql?: { end(): Promise<void> } }).__esionageSql?.end();
}

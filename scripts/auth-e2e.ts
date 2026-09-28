/**
 * End-to-end check of password reset against a running app with SMTP pointed at Mailpit:
 * request, emailed link (in the requester's language), token redirect, new password, one-time
 * tokens, and sign-out everywhere.
 *
 *   pnpm tsx scripts/auth-e2e.ts
 *
 * Env: APP_URL (default http://localhost:3000), MAILPIT_URL (default http://localhost:8025).
 */
try {
  process.loadEnvFile();
} catch {}

const BASE = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const MAILPIT = (process.env.MAILPIT_URL ?? "http://localhost:8025").replace(/\/$/, "");
const RUN = Date.now().toString(36);
const EMAIL = `reset-${RUN}@example.com`;
const OLD_PASSWORD = "old-password-123";
const NEW_PASSWORD = "new-password-456";

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

/** The Better Auth session cookie of one browser. */
class Jar {
  private cookies = new Map<string, string>();
  store(res: Response) {
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(";");
      const eq = pair.indexOf("=");
      const value = pair.slice(eq + 1).trim();
      if (value) this.cookies.set(pair.slice(0, eq).trim(), value);
      else this.cookies.delete(pair.slice(0, eq).trim());
    }
  }
  header() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

async function authPost(path: string, body: unknown, { jar, headers }: { jar?: Jar; headers?: Record<string, string> } = {}) {
  const res = await fetch(`${BASE}/api/auth${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE, cookie: jar?.header() ?? "", ...headers },
    body: JSON.stringify(body),
  });
  jar?.store(res);
  return {
    status: res.status,
    retryAfter: Number(res.headers.get("x-retry-after") ?? res.headers.get("retry-after") ?? 0),
    body: (await res.json().catch(() => null)) as any,
  };
}

async function sessionOf(jar: Jar) {
  const res = await fetch(`${BASE}/api/auth/get-session`, { headers: { cookie: jar.header() } });
  return (await res.json().catch(() => null)) as { user?: { email: string } } | null;
}

/**
 * Production builds rate limit sign-in (3 per 10 s per IP, rolling), and in CI this run follows
 * the MCP e2e's sign-ins; wait out a 429 instead of failing on it.
 */
async function signIn(password: string) {
  for (let attempt = 0; ; attempt++) {
    const jar = new Jar();
    const res = await authPost("/sign-in/email", { email: EMAIL, password }, { jar });
    if (res.status !== 429 || attempt === 2) return { ...res, jar };
    await new Promise((r) => setTimeout(r, (res.retryAfter || 10) * 1000 + 250));
  }
}

type MailpitMessage = { ID: string; Subject: string; Text: string; HTML: string; To: { Address: string }[] };

/** The newest message to `to`, waiting briefly: the app sends reset emails in the background. */
async function latestEmailTo(to: string, after = new Set<string>()): Promise<MailpitMessage> {
  for (let i = 0; i < 40; i++) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
    const { messages } = (await res.json()) as { messages: { ID: string }[] };
    const fresh = messages.find((m) => !after.has(m.ID));
    if (fresh) return (await (await fetch(`${MAILPIT}/api/v1/message/${fresh.ID}`)).json()) as MailpitMessage;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`No email to ${to} arrived in Mailpit`);
}

function resetLinkIn(text: string) {
  return text.match(/https?:\/\/\S+\/api\/auth\/reset-password\/\S+/)?.[0];
}

async function main() {
  const signUp = await authPost("/sign-up/email", { name: "Reset Tester", email: EMAIL, password: OLD_PASSWORD }, { jar: new Jar() });
  check(signUp.status === 200, "sign up a fresh account", signUp.body);
  const first = await signIn(OLD_PASSWORD);
  check(first.status === 200 && (await sessionOf(first.jar))?.user?.email === EMAIL, "an existing session is signed in");

  const unknown = await authPost("/request-password-reset", { email: `nobody-${RUN}@example.com`, redirectTo: "/reset-password" });
  const known = await authPost(
    "/request-password-reset",
    { email: EMAIL, redirectTo: "/reset-password" },
    { headers: { "accept-language": "tr-TR,tr;q=0.9" } },
  );
  check(known.status === 200, "reset request succeeds", known.body);
  check(
    unknown.status === known.status && JSON.stringify(unknown.body) === JSON.stringify(known.body),
    "unknown emails get the same answer as known ones",
    { unknown, known },
  );

  const email = await latestEmailTo(EMAIL);
  check(email.Subject === "Leafdesk şifrenizi sıfırlayın", "reset email is in the requester's language", email.Subject);
  const link = resetLinkIn(email.Text);
  check(link && link.startsWith(`${BASE}/api/auth/reset-password/`), "reset email carries the link", email.Text);
  check(email.HTML.includes(link.replaceAll("&", "&amp;")), "HTML version has the same link");

  const redirect = await fetch(link, { redirect: "manual" });
  const target = new URL(redirect.headers.get("location") ?? "", BASE);
  const token = target.searchParams.get("token");
  check(redirect.status === 302 && target.pathname === "/reset-password" && token, "link redirects to the reset page with a token", {
    status: redirect.status,
    location: redirect.headers.get("location"),
  });

  const page = await fetch(`${BASE}${target.pathname}${target.search}`, { headers: { "accept-language": "en" } });
  check(page.ok && (await page.text()).includes("Choose a new password"), "reset page shows the form");

  const bogus = await fetch(`${BASE}/api/auth/reset-password/not-a-token?callbackURL=%2Freset-password`, { redirect: "manual" });
  check(bogus.headers.get("location")?.includes("error=INVALID_TOKEN"), "a bogus link redirects with INVALID_TOKEN");

  const short = await authPost("/reset-password", { token, newPassword: "short" });
  check(short.status === 400 && short.body?.code === "PASSWORD_TOO_SHORT", "too short a password is rejected", short.body);

  const reset = await authPost("/reset-password", { token, newPassword: NEW_PASSWORD });
  check(reset.status === 200, "password is reset", reset.body);

  const again = await authPost("/reset-password", { token, newPassword: "another-password-789" });
  check(again.status === 400 && again.body?.code === "INVALID_TOKEN", "the token works only once", again.body);

  check(!(await sessionOf(first.jar))?.user, "existing sessions are signed out right away");
  const oldSignIn = await signIn(OLD_PASSWORD);
  check(oldSignIn.status === 401, "the old password no longer works", { status: oldSignIn.status, body: oldSignIn.body });
  const newSignIn = await signIn(NEW_PASSWORD);
  check(newSignIn.status === 200, "the new password works", { status: newSignIn.status, body: newSignIn.body });

  console.log(`\nAll ${passed} checks passed.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

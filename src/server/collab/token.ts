import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

/**
 * Short-lived token the browser hands to the collab websocket. Issued by a Next route
 * for the signed-in user, verified by the Hocuspocus server without touching Better Auth.
 */
type Payload = { u: string; n: string; s?: string; exp: number };

const TTL_SECONDS = 60 * 60;

function sign(data: string) {
  return createHmac("sha256", `collab:${env.authSecret}`).update(data).digest("base64url");
}

/**
 * `sessionId` is the browser session the token is issued to: connecting checks it against the
 * workspace's two-step policy (see collab/authorize.ts).
 */
export function issueCollabToken(userId: string, userName: string, sessionId?: string): string {
  const payload: Payload = {
    u: userId,
    n: userName,
    ...(sessionId ? { s: sessionId } : {}),
    exp: Math.floor(Date.now() / 1000) + TTL_SECONDS,
  };
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${data}.${sign(data)}`;
}

export function verifyCollabToken(token: string): { userId: string; userName: string; sessionId: string | null } | null {
  const [data, signature] = token.split(".");
  if (!data || !signature) return null;
  const expected = Buffer.from(sign(data));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, "base64url").toString()) as Payload;
    if (payload.exp < Date.now() / 1000) return null;
    return { userId: payload.u, userName: payload.n, sessionId: typeof payload.s === "string" ? payload.s : null };
  } catch {
    return null;
  }
}

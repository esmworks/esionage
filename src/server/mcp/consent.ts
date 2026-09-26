import { eq } from "drizzle-orm";
import { constantTimeEqual, makeSignature } from "better-auth/crypto";
import { db } from "@/db";
import { oauthClient } from "@/db/schema";
import { env } from "@/lib/env";
import { clientDisplayName } from "./grants";
import { READ_SCOPE, WRITE_SCOPE } from "./principal";

/** Plain-language descriptions of every scope a client may request. */
export const SCOPE_LABELS: Record<string, string> = {
  openid: "Confirm who you are",
  profile: "See your name and profile picture",
  email: "See your email address",
  offline_access: "Stay connected without asking you to sign in again",
  [READ_SCOPE]: "Read pages and databases in your workspaces",
  [WRITE_SCOPE]: "Create and edit pages and database rows, and move pages to the trash",
};

export function describeScope(scope: string) {
  return SCOPE_LABELS[scope] ?? scope;
}

/**
 * Checks the authorization server's signature on the query it put on the consent URL, the
 * same way the consent endpoint will (HMAC over the sorted parameters, plus `exp`). Only used
 * to decide what to display; the POST to /oauth2/consent re-verifies it.
 */
export async function verifySignedAuthorizationQuery(query: URLSearchParams, secret = env.authSecret): Promise<boolean> {
  const sigs = query.getAll("sig");
  if (sigs.length !== 1) return false;
  const exp = Number(query.get("exp"));
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return false;
  const params = new URLSearchParams(query);
  params.delete("sig");
  const canonical = new URLSearchParams(
    [...params.entries()].sort(([ka, va], [kb, vb]) => (ka < kb ? -1 : ka > kb ? 1 : va < vb ? -1 : va > vb ? 1 : 0)),
  );
  const expected = await makeSignature(canonical.toString(), secret);
  return constantTimeEqual(expected, sigs[0]);
}

export type ConsentClient = {
  clientId: string;
  name: string;
  icon: string | null;
  uri: string | null;
  /** True for CIMD clients: the client id is an https URL whose host vouches for the metadata. */
  metadataDocument: boolean;
};

export async function getConsentClient(clientId: string): Promise<ConsentClient | null> {
  const [client] = await db
    .select({
      clientId: oauthClient.clientId,
      name: oauthClient.name,
      icon: oauthClient.icon,
      uri: oauthClient.uri,
      clientDiscoveryId: oauthClient.clientDiscoveryId,
      disabled: oauthClient.disabled,
    })
    .from(oauthClient)
    .where(eq(oauthClient.clientId, clientId))
    .limit(1);
  if (!client || client.disabled) return null;
  return {
    clientId: client.clientId,
    name: clientDisplayName(client.name, client.clientId),
    icon: safeHttpUrl(client.icon),
    uri: safeHttpUrl(client.uri),
    metadataDocument: Boolean(client.clientDiscoveryId),
  };
}

/** Only http(s) URLs are rendered as links or images. */
export function safeHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

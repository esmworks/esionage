import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { oauthAccessToken, oauthClient, oauthConsent, oauthRefreshToken } from "@/db/schema";

/**
 * JWT access tokens are verified statelessly, so revoking an app in settings would not stop
 * them until they expire. The MCP endpoint therefore also requires a live consent that
 * predates the token: revoking deletes the consent, and re-connecting creates a newer one,
 * so tokens issued before a revoke stay dead.
 */
export async function hasActiveGrant(userId: string, clientId: string, issuedAt?: number): Promise<boolean> {
  const [client] = await db
    .select({ disabled: oauthClient.disabled, skipConsent: oauthClient.skipConsent })
    .from(oauthClient)
    .where(eq(oauthClient.clientId, clientId))
    .limit(1);
  if (!client || client.disabled) return false;
  if (client.skipConsent) return true;
  const [consent] = await db
    .select({ createdAt: oauthConsent.createdAt })
    .from(oauthConsent)
    .where(and(eq(oauthConsent.userId, userId), eq(oauthConsent.clientId, clientId)))
    .limit(1);
  if (!consent) return false;
  // Consent timestamps are stored with second precision.
  if (issuedAt !== undefined && issuedAt * 1000 < consent.createdAt.getTime() - 1000) return false;
  return true;
}

export type ConnectedApp = {
  clientId: string;
  name: string;
  icon: string | null;
  uri: string | null;
  scopes: string[];
  connectedAt: Date;
  updatedAt: Date;
};

export async function listConnectedApps(userId: string): Promise<ConnectedApp[]> {
  const rows = await db
    .select({
      clientId: oauthConsent.clientId,
      scopes: oauthConsent.scopes,
      createdAt: oauthConsent.createdAt,
      updatedAt: oauthConsent.updatedAt,
      name: oauthClient.name,
      icon: oauthClient.icon,
      uri: oauthClient.uri,
    })
    .from(oauthConsent)
    .innerJoin(oauthClient, eq(oauthClient.clientId, oauthConsent.clientId))
    .where(eq(oauthConsent.userId, userId))
    .orderBy(desc(oauthConsent.updatedAt));
  return rows.map((r) => ({
    clientId: r.clientId,
    name: clientDisplayName(r.name, r.clientId),
    icon: r.icon,
    uri: r.uri,
    scopes: r.scopes,
    connectedAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
}

/** Removes the user's consent for a client and revokes every token it holds for the user. */
export async function revokeConnectedApp(userId: string, clientId: string) {
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.delete(oauthConsent).where(and(eq(oauthConsent.userId, userId), eq(oauthConsent.clientId, clientId)));
    await tx
      .update(oauthRefreshToken)
      .set({ revoked: now })
      .where(
        and(eq(oauthRefreshToken.userId, userId), eq(oauthRefreshToken.clientId, clientId), isNull(oauthRefreshToken.revoked)),
      );
    await tx
      .update(oauthAccessToken)
      .set({ revoked: now })
      .where(
        and(eq(oauthAccessToken.userId, userId), eq(oauthAccessToken.clientId, clientId), isNull(oauthAccessToken.revoked)),
      );
  });
}

/** Like revokeConnectedApp for every app the user has connected, including tokens without consent. */
export async function revokeAllConnectedApps(userId: string) {
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.delete(oauthConsent).where(eq(oauthConsent.userId, userId));
    await tx
      .update(oauthRefreshToken)
      .set({ revoked: now })
      .where(and(eq(oauthRefreshToken.userId, userId), isNull(oauthRefreshToken.revoked)));
    await tx
      .update(oauthAccessToken)
      .set({ revoked: now })
      .where(and(eq(oauthAccessToken.userId, userId), isNull(oauthAccessToken.revoked)));
  });
}

/** A readable name for a client: its registered name, else the host of a URL client id (CIMD). */
export function clientDisplayName(name: string | null | undefined, clientId: string) {
  if (name?.trim()) return name.trim();
  try {
    return new URL(clientId).host;
  } catch {
    return "Unnamed app";
  }
}

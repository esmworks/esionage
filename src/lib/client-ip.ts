/** Set by server.ts on every request from the socket and trusted proxies; never taken from the client. */
export const CLIENT_IP_HEADER = "x-leafdesk-client-ip";

/** TRUSTED_PROXIES: how many reverse proxies stand in front of the app (default 1). */
export function trustedProxyCount(value = process.env.TRUSTED_PROXIES) {
  const n = Number((value ?? "").trim() || 1);
  return Number.isInteger(n) && n >= 0 ? n : 1;
}

/**
 * The visitor's address. Each proxy appends the address it was reached from to X-Forwarded-For,
 * and the app sees the last proxy as the socket, so the visitor is the entry `trusted` places left
 * of the socket. Anything further left was written by the visitor and can say anything.
 */
export function clientIpFrom(forwardedFor: string | string[] | undefined, socketAddress: string | undefined, trusted: number) {
  const forwarded = (Array.isArray(forwardedFor) ? forwardedFor.join(",") : (forwardedFor ?? ""))
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const chain = [...forwarded, socketAddress ?? "unknown"];
  return chain[Math.max(0, chain.length - 1 - trusted)].slice(0, 100);
}

import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { request as httpRequest, type IncomingMessage, type RequestOptions } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";

/**
 * Fetches a file from a URL someone gave us (MCP's attach_file) without letting that URL reach
 * inside our network (SSRF): only http(s), and only hosts whose every address is public. The check
 * runs inside the connection's own DNS lookup, so the address that was checked is the one connected
 * to (no DNS rebinding between check and connect), and again on every redirect. A size limit and a
 * deadline bound the whole transfer.
 */

export class RemoteFetchError extends Error {
  constructor(
    message: string,
    readonly code: "badUrl" | "blocked" | "tooLarge" | "timeout" | "httpError" | "tooManyRedirects" | "network",
  ) {
    super(message);
    this.name = "RemoteFetchError";
  }
}

function ipv4Bytes(address: string): number[] | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  const bytes = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  return bytes.every((b) => b >= 0 && b <= 255) ? bytes : null;
}

function ipv6Bytes(input: string): number[] | null {
  let address = input.replace(/^\[|\]$/g, "").split("%")[0].toLowerCase();
  // A trailing dotted quad (::ffff:1.2.3.4) becomes two hextets.
  const quad = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(address);
  if (quad) {
    const v4 = ipv4Bytes(quad[1]);
    if (!v4) return null;
    address = address.slice(0, -quad[1].length) + `${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  }
  const halves = address.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.flatMap((g) => {
    const n = parseInt(g, 16);
    return [n >> 8, n & 0xff];
  });
}

const inPrefix = (bytes: number[], prefix: number[], bits: number) => {
  for (let i = 0; i < bits; i++) {
    const byte = i >> 3;
    const mask = 0x80 >> (i & 7);
    if ((bytes[byte] & mask) !== ((prefix[byte] ?? 0) & mask)) return false;
  }
  return true;
};

/** IPv4 ranges that aren't the public internet (RFC 6890 and friends). */
const BLOCKED_V4: [number[], number][] = [
  [[0], 8], // "this" network
  [[10], 8], // private
  [[100, 64], 10], // carrier-grade NAT
  [[127], 8], // loopback
  [[169, 254], 16], // link-local (cloud metadata lives here)
  [[172, 16], 12], // private
  [[192, 0, 0], 24], // IETF protocol assignments
  [[192, 0, 2], 24], // documentation
  [[192, 88, 99], 24], // 6to4 relay anycast
  [[192, 168], 16], // private
  [[198, 18], 15], // benchmarking
  [[198, 51, 100], 24], // documentation
  [[203, 0, 113], 24], // documentation
  [[224], 4], // multicast
  [[240], 4], // reserved, broadcast
];

/** IPv6 ranges that aren't the public internet. Ranges that embed an IPv4 address are checked by it. */
const BLOCKED_V6: [number[], number][] = [
  [[0x01, 0x00], 64], // discard-only
  [[0x20, 0x01], 23], // IETF protocol assignments (Teredo included)
  [[0x20, 0x01, 0x0d, 0xb8], 32], // documentation
  [[0xfc], 7], // unique local
  [[0xfe, 0x80], 10], // link-local
  [[0xfe, 0xc0], 10], // site-local (deprecated)
  [[0xff], 8], // multicast
];

/** True for loopback, private, link-local and other addresses a fetch must never reach. */
export function isBlockedAddress(address: string): boolean {
  const family = isIP(address.replace(/^\[|\]$/g, "").split("%")[0]);
  if (family === 4) {
    const bytes = ipv4Bytes(address)!;
    return BLOCKED_V4.some(([prefix, bits]) => inPrefix(bytes, prefix, bits));
  }
  if (family !== 6) return true;
  const bytes = ipv6Bytes(address);
  if (!bytes) return true;
  const zeros = (from: number, to: number) => bytes.slice(from, to).every((b) => b === 0);
  // ::ffff:a.b.c.d (IPv4-mapped) and 64:ff9b::a.b.c.d (NAT64) reach the embedded IPv4 address.
  if (zeros(0, 10) && bytes[10] === 0xff && bytes[11] === 0xff) return isBlockedAddress(bytes.slice(12).join("."));
  if (inPrefix(bytes, [0x00, 0x64, 0xff, 0x9b], 96)) return isBlockedAddress(bytes.slice(12).join("."));
  // 6to4 (2002:a.b.c.d::/48) as well.
  if (inPrefix(bytes, [0x20, 0x02], 16)) return isBlockedAddress(bytes.slice(2, 6).join("."));
  // ::, ::1 and the old IPv4-compatible ::a.b.c.d.
  if (zeros(0, 12)) return true;
  return BLOCKED_V6.some(([prefix, bits]) => inPrefix(bytes, prefix, bits));
}

export type RemoteFetchOptions = {
  maxBytes: number;
  timeoutMs?: number;
  maxRedirects?: number;
  /** Tests only: which addresses count as off limits. */
  isBlocked?: (address: string) => boolean;
};

export type RemoteFile = {
  /** The response body; read it to the end or destroy it. Destroyed on the deadline. */
  body: IncomingMessage;
  contentType: string | null;
  /** From Content-Disposition, else the last part of the final URL's path. */
  name: string | null;
  /** Content-Length, when the server sent one. */
  size: number | null;
};

/** A DNS lookup that refuses hosts with any blocked address, for http.request's `lookup`. */
function guardedLookup(isBlocked: (address: string) => boolean): LookupFunction {
  return (hostname, options, callback) => {
    dnsLookup(hostname, { ...options, all: true }, (error, found) => {
      if (error) return callback(error, "", 0);
      const addresses = found as unknown as LookupAddress[];
      if (!addresses.length || addresses.some((a) => isBlocked(a.address))) {
        const blocked = Object.assign(new Error(`${hostname} resolves to an address that isn't public`), { code: "EBLOCKED" });
        return callback(blocked, "", 0);
      }
      if ((options as { all?: boolean }).all) (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, addresses);
      else callback(null, addresses[0].address, addresses[0].family);
    });
  };
}

function nameFrom(disposition: string | undefined, url: URL): string | null {
  if (disposition) {
    const star = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(disposition);
    if (star) {
      try {
        return decodeURIComponent(star[1].trim());
      } catch {}
    }
    const plain = /filename\s*=\s*"?([^";]+)"?/.exec(disposition);
    if (plain) return plain[1].trim();
  }
  const last = url.pathname.split("/").filter(Boolean).pop();
  if (!last) return null;
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

/** Fetches `input` (GET), following up to `maxRedirects` redirects, each checked like the first. */
export async function fetchRemoteFile(input: string, options: RemoteFetchOptions): Promise<RemoteFile> {
  const { maxBytes, timeoutMs = 30_000, maxRedirects = 5, isBlocked = isBlockedAddress } = options;
  const deadline = Date.now() + timeoutMs;
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new RemoteFetchError("That isn't a valid URL", "badUrl");
  }
  for (let hop = 0; ; hop++) {
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new RemoteFetchError("Only http and https URLs can be fetched", "badUrl");
    if (url.username || url.password) throw new RemoteFetchError("URLs with credentials can't be fetched", "badUrl");
    const host = url.hostname.replace(/^\[|\]$/g, "");
    // Literal addresses skip DNS, so the lookup guard never sees them.
    if (isIP(host) && isBlocked(host)) throw new RemoteFetchError("That address isn't public", "blocked");
    const res = await get(url, { isBlocked, deadline });
    const status = res.statusCode ?? 0;
    if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
      res.resume();
      if (hop >= maxRedirects) throw new RemoteFetchError("Too many redirects", "tooManyRedirects");
      url = new URL(res.headers.location, url);
      continue;
    }
    if (status < 200 || status >= 300) {
      res.resume();
      throw new RemoteFetchError(`The server answered ${status}`, "httpError");
    }
    const length = res.headers["content-length"] ? Number(res.headers["content-length"]) : null;
    if (length !== null && length > maxBytes) {
      res.destroy();
      throw new RemoteFetchError("The file is too large", "tooLarge");
    }
    // The deadline covers reading the body too.
    const timer = setTimeout(() => res.destroy(new RemoteFetchError("The download took too long", "timeout")), Math.max(0, deadline - Date.now()));
    res.once("close", () => clearTimeout(timer));
    return {
      body: res,
      contentType: res.headers["content-type"] ?? null,
      name: nameFrom(res.headers["content-disposition"], url),
      size: length,
    };
  }
}

function get(url: URL, { isBlocked, deadline }: { isBlocked: (address: string) => boolean; deadline: number }): Promise<IncomingMessage> {
  return new Promise((resolveGet, reject) => {
    const send = url.protocol === "https:" ? httpsRequest : httpRequest;
    const options: RequestOptions = {
      method: "GET",
      lookup: guardedLookup(isBlocked),
      headers: { "user-agent": "Esionage (+file attachment)", accept: "*/*", "accept-encoding": "identity" },
      // A fresh connection per request: pooled sockets would skip the lookup.
      agent: false,
    };
    const req = send(url, options, resolveGet);
    const timer = setTimeout(() => req.destroy(new RemoteFetchError("The download took too long", "timeout")), Math.max(0, deadline - Date.now()));
    req.once("response", () => clearTimeout(timer));
    req.once("error", (error: Error & { code?: string }) => {
      clearTimeout(timer);
      if (error instanceof RemoteFetchError) reject(error);
      else if (error.code === "EBLOCKED") reject(new RemoteFetchError(error.message, "blocked"));
      else reject(new RemoteFetchError(`Couldn't reach ${url.host}`, "network"));
    });
    req.end();
  });
}

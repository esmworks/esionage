import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * RFC 6238 time-based one-time passwords (SHA-1, 6 digits, 30 s), the kind authenticator apps
 * show. Better Auth verifies sign-in codes itself; this is for the few checks it has no endpoint
 * for (turning two-step verification off without a password) and for the end-to-end script,
 * which plays the authenticator app.
 */
const PERIOD = 30;
const DIGITS = 6;
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Decode(input: string) {
  const clean = input.replace(/=+$/, "").replace(/\s+/g, "").toUpperCase();
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index === -1) throw new Error(`Not a base32 character: ${char}`);
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** The code for `key` at `time` (ms since the epoch). */
export function totpCode(key: Uint8Array, time = Date.now()) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(time / 1000 / PERIOD)));
  const hmac = createHmac("sha1", key).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const number = (hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS;
  return number.toString().padStart(DIGITS, "0");
}

/** Whether `code` is the current code, or the one just before or after (clock drift). */
export function verifyTotp(key: Uint8Array, code: string, time = Date.now()) {
  const given = Buffer.from(code.replace(/\s+/g, ""));
  let matched = false;
  for (const step of [-1, 0, 1]) {
    const expected = Buffer.from(totpCode(key, time + step * PERIOD * 1000));
    if (given.length === expected.length && timingSafeEqual(given, expected)) matched = true;
  }
  return matched;
}

/** The secret key inside an `otpauth://totp/...?secret=` URI. */
export function totpKeyFromUri(uri: string) {
  const secret = new URL(uri).searchParams.get("secret");
  if (!secret) throw new Error("The URI has no secret");
  return base32Decode(secret);
}

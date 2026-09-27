import { describe, expect, it } from "vitest";
import { base32Decode, totpCode, totpKeyFromUri, verifyTotp } from "./totp";

// RFC 6238 appendix B, SHA-1 key, last six digits of the eight-digit codes.
const KEY = Buffer.from("12345678901234567890");

describe("totpCode", () => {
  it("matches the RFC 6238 test vectors", () => {
    expect(totpCode(KEY, 59_000)).toBe("287082");
    expect(totpCode(KEY, 1_111_111_109_000)).toBe("081804");
    expect(totpCode(KEY, 1_234_567_890_000)).toBe("005924");
    expect(totpCode(KEY, 2_000_000_000_000)).toBe("279037");
  });
});

describe("verifyTotp", () => {
  const now = 1_234_567_890_000;

  it("accepts the current code and the ones just before and after", () => {
    expect(verifyTotp(KEY, totpCode(KEY, now), now)).toBe(true);
    expect(verifyTotp(KEY, totpCode(KEY, now - 30_000), now)).toBe(true);
    expect(verifyTotp(KEY, totpCode(KEY, now + 30_000), now)).toBe(true);
  });

  it("rejects older codes, other keys and malformed input", () => {
    expect(verifyTotp(KEY, totpCode(KEY, now - 90_000), now)).toBe(false);
    expect(verifyTotp(Buffer.from("another key"), totpCode(KEY, now), now)).toBe(false);
    expect(verifyTotp(KEY, "12345", now)).toBe(false);
    expect(verifyTotp(KEY, "", now)).toBe(false);
  });

  it("ignores spaces people type in the middle", () => {
    const code = totpCode(KEY, now);
    expect(verifyTotp(KEY, `${code.slice(0, 3)} ${code.slice(3)}`, now)).toBe(true);
  });
});

describe("base32", () => {
  it("decodes RFC 4648 base32, padded or not, any case", () => {
    expect(base32Decode("MZXW6YTBOI").toString()).toBe("foobar");
    expect(base32Decode("MZXW6YTBOI======").toString()).toBe("foobar");
    expect(base32Decode("mzxw 6ytb oi").toString()).toBe("foobar");
    expect(() => base32Decode("MZ1")).toThrow();
  });

  it("reads the key out of an otpauth URI", () => {
    const uri = "otpauth://totp/Esionage:a%40example.test?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=Esionage&digits=6&period=30";
    expect(totpKeyFromUri(uri).equals(KEY)).toBe(true);
    expect(() => totpKeyFromUri("otpauth://totp/x?issuer=y")).toThrow();
  });
});

import { describe, expect, it } from "vitest";
import { securityErrorKey } from "./auth-errors";
import { defaultPasskeyName } from "./passkey-name";

describe("securityErrorKey", () => {
  it("maps the codes we have wording for", () => {
    expect(securityErrorKey({ code: "INVALID_PASSWORD", status: 400 })).toBe("wrongPassword");
    expect(securityErrorKey({ code: "INVALID_CODE", status: 401 })).toBe("invalidCode");
    expect(securityErrorKey({ code: "INVALID_BACKUP_CODE", status: 401 })).toBe("invalidCode");
    expect(securityErrorKey({ code: "SESSION_NOT_FRESH", status: 403 })).toBe("signInAgain");
    expect(securityErrorKey({ code: "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED" })).toBe("passkeyExists");
  });

  it("tells a locked account apart from plain rate limiting, though both answer 429", () => {
    expect(securityErrorKey({ code: "ACCOUNT_TEMPORARILY_LOCKED", status: 429 })).toBe("locked");
    expect(securityErrorKey({ status: 429 })).toBe("tooManyAttempts");
  });

  it("stays quiet when the person closed the passkey prompt", () => {
    expect(securityErrorKey({ code: "AUTH_CANCELLED", status: 400 })).toBeNull();
    expect(securityErrorKey({ code: "ERROR_CEREMONY_ABORTED", status: 400 })).toBeNull();
    expect(securityErrorKey(null)).toBeNull();
  });

  it("falls back to a generic message", () => {
    expect(securityErrorKey({ code: "SOMETHING_NEW", status: 500 })).toBe("generic");
    expect(securityErrorKey({ code: "hasOwnProperty" })).toBe("generic");
  });
});

describe("defaultPasskeyName", () => {
  it("names the passkey after the device", () => {
    expect(defaultPasskeyName("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15")).toBe("Mac");
    expect(defaultPasskeyName("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)")).toBe("iPhone");
    expect(defaultPasskeyName("Mozilla/5.0 (Linux; Android 15; Pixel 9)")).toBe("Android");
    expect(defaultPasskeyName("Mozilla/5.0 (X11; CrOS x86_64 14541.0.0)")).toBe("Chromebook");
    expect(defaultPasskeyName("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("Windows");
    expect(defaultPasskeyName("curl/8.0")).toBe("Passkey");
  });
});

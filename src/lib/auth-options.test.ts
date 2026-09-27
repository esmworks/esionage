import { describe, expect, it } from "vitest";
import { closedSignUpAdmits, guardUpdateUser, inviteTokenOf, joinTokenOf, socialTokenOf } from "./auth-options";

describe("guardUpdateUser", () => {
  it("lets a valid name through, and removing the picture", () => {
    expect(() => guardUpdateUser({ name: "Ayşe" })).not.toThrow();
    expect(() => guardUpdateUser({ image: null })).not.toThrow();
  });

  it("refuses picture URLs and other fields: pictures are uploaded", () => {
    expect(() => guardUpdateUser({ image: "https://tracker.example.com/p.gif" })).toThrow(/Only the name/);
    expect(() => guardUpdateUser({ image: "/api/avatars/someone-else/0123456789abcdef0123456789abcdef-png" })).toThrow();
    expect(() => guardUpdateUser({ name: "Ok", twoFactorEnabled: false })).toThrow(/Only the name/);
  });

  it("refuses empty and overlong names", () => {
    expect(() => guardUpdateUser({ name: "  " })).toThrow(/name/);
    expect(() => guardUpdateUser({ name: "x".repeat(81) })).toThrow(/name/);
  });
});

describe("inviteTokenOf", () => {
  it("reads the parsed query first", () => {
    expect(inviteTokenOf({ query: { invite: "abc" } })).toBe("abc");
  });

  it("falls back to the request URL", () => {
    const request = new Request("https://notes.example.com/api/auth/sign-up/email?invite=xyz", { method: "POST" });
    expect(inviteTokenOf({ request })).toBe("xyz");
  });

  it("returns null without a token or context", () => {
    expect(inviteTokenOf({ request: new Request("https://notes.example.com/api/auth/sign-up/email") })).toBeNull();
    expect(inviteTokenOf(null)).toBeNull();
    expect(inviteTokenOf({ query: { invite: ["a", "b"] } })).toBeNull();
  });
});

describe("joinTokenOf", () => {
  it("reads the join token from the query or the request URL", () => {
    expect(joinTokenOf({ query: { join: "abc" } })).toBe("abc");
    const request = new Request("https://notes.example.com/api/auth/sign-up/email?join=xyz", { method: "POST" });
    expect(joinTokenOf({ request })).toBe("xyz");
  });

  it("does not confuse invitation and join tokens", () => {
    expect(joinTokenOf({ query: { invite: "abc" } })).toBeNull();
    expect(inviteTokenOf({ query: { join: "abc" } })).toBeNull();
  });
});

describe("socialTokenOf", () => {
  it("reads a string token from the OAuth state's server context", () => {
    expect(socialTokenOf({ invite: "abc", join: "xyz" }, "invite")).toBe("abc");
    expect(socialTokenOf({ invite: "abc", join: "xyz" }, "join")).toBe("xyz");
  });

  it("returns null for a missing, empty or non-string token", () => {
    expect(socialTokenOf(undefined, "invite")).toBeNull();
    expect(socialTokenOf({ invite: "" }, "invite")).toBeNull();
    expect(socialTokenOf({ invite: 1 }, "invite")).toBeNull();
  });
});

describe("closedSignUpAdmits", () => {
  const check = async (token: string, email: string) => token === "t" && email === "a@example.com";

  it("admits only an invitation for the same email", async () => {
    expect(await closedSignUpAdmits("t", "a@example.com", check)).toBe(true);
    expect(await closedSignUpAdmits("t", "b@example.com", check)).toBe(false);
    expect(await closedSignUpAdmits("other", "a@example.com", check)).toBe(false);
  });

  it("admits nobody without a token, an email or a way to check", async () => {
    expect(await closedSignUpAdmits(null, "a@example.com", check)).toBe(false);
    expect(await closedSignUpAdmits("t", undefined, check)).toBe(false);
    expect(await closedSignUpAdmits("t", "a@example.com")).toBe(false);
  });
});

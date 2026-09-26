import { describe, expect, it } from "vitest";
import { inviteTokenOf } from "./auth-options";

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

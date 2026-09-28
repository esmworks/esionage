import { describe, expect, it } from "vitest";
import { DEFAULT_SESSION_DAYS, sessionDaysFrom, sessionLifetime } from "./session-lifetime";

describe("SESSION_MAX_AGE_DAYS", () => {
  it("reads whole days", () => {
    expect(sessionDaysFrom("30")).toBe(30);
    expect(sessionDaysFrom(" 1 ")).toBe(1);
    expect(sessionDaysFrom("3650")).toBe(3650);
  });

  it("falls back to Better Auth's seven days when unset or invalid", () => {
    for (const value of [undefined, "", "0", "-3", "1.5", "abc", "3651"]) expect(sessionDaysFrom(value)).toBe(DEFAULT_SESSION_DAYS);
    expect(DEFAULT_SESSION_DAYS).toBe(7);
  });

  it("gives Better Auth the lifetime in seconds, extended before it runs out", () => {
    expect(sessionLifetime(7)).toEqual({ expiresIn: 7 * 86_400, updateAge: 86_400 });
    expect(sessionLifetime(1)).toEqual({ expiresIn: 86_400, updateAge: 43_200 });
  });
});

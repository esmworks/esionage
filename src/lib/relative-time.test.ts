import { describe, expect, it } from "vitest";
import { relativeTime } from "./relative-time";

const now = new Date("2026-09-27T10:00:00Z");
const ago = (seconds: number) => new Date(now.getTime() - seconds * 1000);

describe("relativeTime", () => {
  it("uses the largest whole unit", () => {
    expect(relativeTime(ago(30), "en", now)).toBe("now");
    expect(relativeTime(ago(5 * 60), "en", now)).toBe("5 minutes ago");
    expect(relativeTime(ago(3 * 3600), "en", now)).toBe("3 hours ago");
    expect(relativeTime(ago(26 * 3600), "en", now)).toBe("yesterday");
    expect(relativeTime(ago(15 * 24 * 3600), "en", now)).toBe("2 weeks ago");
  });

  it("follows the locale", () => {
    expect(relativeTime(ago(5 * 60), "tr", now)).toBe("5 dakika önce");
    expect(relativeTime(ago(26 * 3600), "tr", now)).toBe("dün");
  });
});

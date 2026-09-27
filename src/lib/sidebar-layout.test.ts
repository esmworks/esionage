import { describe, expect, it } from "vitest";
import { formatSidebarCookie, parseSidebarCookie, SIDEBAR_WIDTH } from "./sidebar-layout";

describe("sidebar layout cookie", () => {
  it("round-trips collapsed state and width", () => {
    expect(parseSidebarCookie(formatSidebarCookie({ collapsed: true, width: 300 }))).toEqual({ collapsed: true, width: 300 });
    expect(parseSidebarCookie("0:280")).toEqual({ collapsed: false, width: 280 });
  });

  it("falls back to defaults and clamps widths", () => {
    expect(parseSidebarCookie(undefined)).toEqual({ collapsed: false, width: SIDEBAR_WIDTH.default });
    expect(parseSidebarCookie("x:abc")).toEqual({ collapsed: false, width: SIDEBAR_WIDTH.default });
    expect(parseSidebarCookie("1:5000").width).toBe(SIDEBAR_WIDTH.max);
    expect(parseSidebarCookie("0:10").width).toBe(SIDEBAR_WIDTH.min);
  });
});

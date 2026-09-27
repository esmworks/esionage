import { describe, expect, it } from "vitest";
import { printOrder, printPath } from "./print";

const row = (id: string, parentId: string | null, position: number, createdAt = "2026-01-01T00:00:00Z") => ({
  id,
  parentId,
  position,
  createdAt,
});

describe("print view", () => {
  it("builds its address", () => {
    expect(printPath("abc")).toBe("/print/abc");
    expect(printPath("abc", { auto: true })).toBe("/print/abc?auto=1");
    expect(printPath("abc", { subpages: true, auto: true })).toBe("/print/abc?subpages=1&auto=1");
    expect(printPath("a/b?c")).toBe("/print/a%2Fb%3Fc");
  });

  it("orders pages depth first in sidebar order", () => {
    const rows = [
      row("root", "top", 0),
      row("b", "root", 2),
      row("a", "root", 1),
      row("a2", "a", 2),
      row("a1", "a", 1),
      row("c", "root", 2, "2026-02-01T00:00:00Z"),
      row("stray", "elsewhere", 0),
    ];
    const { pages, truncated } = printOrder("root", rows);
    expect(pages).toEqual([
      { id: "root", depth: 0 },
      { id: "a", depth: 1 },
      { id: "a1", depth: 2 },
      { id: "a2", depth: 2 },
      { id: "b", depth: 1 },
      { id: "c", depth: 1 },
    ]);
    expect(truncated).toBe(false);
  });

  it("stops at the limit and says so", () => {
    const rows = [row("root", null, 0), ...Array.from({ length: 5 }, (_, i) => row(`p${i}`, "root", i))];
    const { pages, truncated } = printOrder("root", rows, 3);
    expect(pages.map((p) => p.id)).toEqual(["root", "p0", "p1"]);
    expect(truncated).toBe(true);
    expect(printOrder("root", rows, 6).truncated).toBe(false);
  });

  it("prints just the page when nothing hangs from it, and survives cycles", () => {
    expect(printOrder("root", []).pages).toEqual([{ id: "root", depth: 0 }]);
    const cyclic = [row("a", "root", 0), row("root", "a", 0)];
    expect(printOrder("root", cyclic).pages.map((p) => p.id)).toEqual(["root", "a"]);
  });
});

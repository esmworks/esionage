import { describe, expect, it } from "vitest";
import { placeInSections, PRIVATE_SECTION, SHARED_SECTION, type SectionRow } from "./tree-sections";

const row = (id: string, over: Partial<SectionRow> = {}): SectionRow => ({
  id,
  parentId: null,
  teamspaceId: null,
  mine: false,
  shared: false,
  ...over,
});

describe("placeInSections", () => {
  const joined = new Set(["eng"]);

  it("puts the top pages of joined teamspaces in their section and nests their subpages", () => {
    const placed = placeInSections([row("a", { teamspaceId: "eng" }), row("b", { teamspaceId: "eng", parentId: "a" })], joined);
    expect(placed.get("a")).toEqual({ section: "eng", parentId: null });
    expect(placed.get("b")).toEqual({ section: "eng", parentId: "a" });
  });

  it("puts one's own pages outside any teamspace under private", () => {
    const placed = placeInSections([row("p", { mine: true }), row("q", { parentId: "p", mine: true })], joined);
    expect(placed.get("p")).toEqual({ section: PRIVATE_SECTION, parentId: null });
    expect(placed.get("q")).toEqual({ section: PRIVATE_SECTION, parentId: "p" });
  });

  it("leaves out pages of teamspaces not joined unless shared by name, which go to shared", () => {
    const placed = placeInSections(
      [row("o", { teamspaceId: "open-ts" }), row("o2", { teamspaceId: "open-ts", parentId: "o" }), row("s", { teamspaceId: "closed-ts", shared: true })],
      joined,
    );
    expect(placed.has("o")).toBe(false);
    expect(placed.has("o2")).toBe(false);
    expect(placed.get("s")).toEqual({ section: SHARED_SECTION, parentId: null });
  });

  it("lifts a shared page under an unplaced parent to the top of shared", () => {
    const placed = placeInSections(
      [row("o", { teamspaceId: "open-ts" }), row("child", { teamspaceId: "open-ts", parentId: "o", shared: true })],
      joined,
    );
    expect(placed.get("child")).toEqual({ section: SHARED_SECTION, parentId: null });
  });

  it("shows someone else's private page opened to the workspace under shared", () => {
    const placed = placeInSections([row("x")], joined);
    expect(placed.get("x")).toEqual({ section: SHARED_SECTION, parentId: null });
  });

  it("puts a teamspace page whose parent is hidden at the top of its teamspace", () => {
    const placed = placeInSections([row("c", { teamspaceId: "eng", parentId: "hidden" })], joined);
    expect(placed.get("c")).toEqual({ section: "eng", parentId: null });
  });

  it("survives a parent cycle", () => {
    const placed = placeInSections([row("a", { parentId: "b", mine: true }), row("b", { parentId: "a", mine: true })], joined);
    expect(placed.size).toBeLessThanOrEqual(2);
  });
});

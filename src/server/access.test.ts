import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import { hasLevel, pageAccessFor, pageVisibleTo, type AccessLevel } from "./access";

vi.mock("@/db", () => ({ db: {} }));

describe("pageAccessFor", () => {
  it("gives every workspace member full access and everyone else none", () => {
    expect(pageAccessFor({ role: "owner" })).toBe("full");
    expect(pageAccessFor({ role: "member" })).toBe("full");
    expect(pageAccessFor({ role: null })).toBe("none");
  });
});

describe("hasLevel", () => {
  const cases: [AccessLevel, "view" | "edit" | "full", boolean][] = [
    ["none", "view", false],
    ["view", "view", true],
    ["view", "edit", false],
    ["edit", "edit", true],
    ["edit", "full", false],
    ["full", "view", true],
    ["full", "full", true],
  ];
  it.each(cases)("%s satisfies %s: %s", (level, needed, expected) => {
    expect(hasLevel(level, needed)).toBe(expected);
  });
});

describe("pageVisibleTo", () => {
  const render = (userId: string, alias?: string) => new PgDialect().sqlToQuery(pageVisibleTo(userId, alias));

  it("checks membership of the page's workspace, with the user as a parameter", () => {
    const { sql, params } = render("user-1");
    expect(sql).toContain('"workspace_member"."user_id" = $1');
    expect(sql).toContain('"page"."workspace_id"');
    expect(params).toEqual(["user-1"]);
  });

  it("uses the alias of a raw query", () => {
    expect(render("user-1", "p").sql).toContain('"p"."workspace_id"');
  });

  it("refuses aliases that could inject SQL", () => {
    expect(() => pageVisibleTo("user-1", 'p"; drop table page; --')).toThrow();
  });
});

/**
 * Page access must be decided in access.ts only. A query that joins workspace_member elsewhere
 * would bypass page-level sharing once it exists, so membership tables may only appear in the
 * access module and in workspace/member management.
 */
describe("access checks stay in one place", () => {
  const root = join(__dirname, "..");
  const ALLOWED = new Set(["server/access.ts", "server/workspaces.ts"]);

  function sources(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return entry.name === "db" && dir === root ? [] : sources(path);
      return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
    });
  }

  it("no other module reads workspace_member", () => {
    const offenders = sources(root)
      .map((path) => relative(root, path))
      .filter((path) => !ALLOWED.has(path))
      .filter((path) => /\bworkspaceMember\b|workspace_member/.test(readFileSync(join(root, path), "utf8")));
    expect(offenders).toEqual([]);
  });
});

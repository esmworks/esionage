import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RequestSession } from "./request-session";

/**
 * The two-step policy in the access checks: which sessions it holds back, and that it asks the
 * database once per request and workspace. The database answers from a queue, one result per query.
 */
const results: unknown[][] = [];
let queries = 0;

function chain(): unknown {
  const node: Record<string, unknown> = {};
  for (const method of ["select", "from", "innerJoin", "leftJoin", "where"]) node[method] = () => node;
  node.limit = async () => {
    queries++;
    return results.shift() ?? [];
  };
  return node;
}

vi.mock("@/db", () => ({ db: { select: () => (chain() as { select: () => unknown }).select() } }));

let current: RequestSession | null = null;
vi.mock("./request-session", () => ({ requestSession: async () => current }));

const { getMembership, findMembership, resolvePageAccess, requireMembership, TwoFactorRequiredError, workspacesHeldBack } =
  await import("./access");
const { authorizeCollab } = await import("./collab/authorize");

const session = (userId: string, strong: boolean): RequestSession => ({ userId, strong, heldBack: new Map() });
const member = [{ role: "member" }];
const applies = [{ one: 1 }];
const visiblePage = [{ id: "p1", workspaceId: "ws1", title: "Plan", level: 1 }];

beforeEach(() => {
  results.length = 0;
  queries = 0;
  current = null;
});

describe("the two-step policy in access checks", () => {
  it("leaves requests without a browser session alone (collab server, scripts, MCP)", async () => {
    results.push(member);
    expect(await getMembership("u1", "ws1")).toEqual({ role: "member" });
    expect(queries).toBe(1);
  });

  it("holds back a session that doesn't pass, once per request and workspace", async () => {
    current = session("u1", false);
    results.push(member, applies);
    await expect(getMembership("u1", "ws1")).rejects.toBeInstanceOf(TwoFactorRequiredError);
    results.push(member);
    const error = await requireMembership("u1", "ws1").catch((e: unknown) => e);
    expect(error).toMatchObject({ name: "TwoFactorRequiredError", workspaceId: "ws1" });
    expect(queries).toBe(3); // two memberships, one policy lookup
  });

  it("lets sessions through that pass, or where the workspace doesn't require it", async () => {
    current = session("u1", true);
    results.push(member);
    expect(await getMembership("u1", "ws1")).toEqual({ role: "member" });
    current = session("u1", false);
    results.push(member, []);
    expect(await getMembership("u1", "ws1")).toEqual({ role: "member" });
  });

  it("doesn't apply to questions about other people", async () => {
    current = session("u1", false);
    results.push(member);
    expect(await getMembership("u2", "ws1")).toEqual({ role: "member" });
    expect(queries).toBe(1);
  });

  it("leaves findMembership (the policy's own lookups) alone", async () => {
    current = session("u1", false);
    results.push(member);
    expect(await findMembership("u1", "ws1")).toEqual({ role: "member" });
  });

  it("holds back pages only when they are visible, so nothing leaks about the others", async () => {
    current = session("u1", false);
    results.push([{ ...visiblePage[0], level: 0 }]);
    expect((await resolvePageAccess("u1", "p1")).level).toBe("none");
    results.push(visiblePage, applies);
    await expect(resolvePageAccess("u1", "p1")).rejects.toMatchObject({ workspaceId: "ws1" });
  });

  it("names the workspaces a list has to leave out", async () => {
    current = session("u1", false);
    results.push(applies, []);
    expect([...(await workspacesHeldBack("u1", ["ws1", "ws2", "ws1"]))]).toEqual(["ws1"]);
  });
});

describe("collab connections", () => {
  it("need a session that passes when the workspace requires it", async () => {
    results.push(visiblePage, applies);
    await expect(authorizeCollab("u1", { kind: "page", id: "p1" })).rejects.toBeInstanceOf(TwoFactorRequiredError);
    results.push(visiblePage);
    expect(await authorizeCollab("u1", { kind: "page", id: "p1" }, { strong: true })).toEqual({ readOnly: true });
    results.push(member, applies);
    await expect(authorizeCollab("u1", { kind: "ws", id: "ws1" })).rejects.toBeInstanceOf(TwoFactorRequiredError);
    results.push(member, []);
    expect(await authorizeCollab("u1", { kind: "ws", id: "ws1" })).toEqual({ readOnly: false });
  });
});

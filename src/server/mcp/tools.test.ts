import { InMemoryTransport, type JSONRPCMessage } from "@modelcontextprotocol/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccessError } from "@/server/access";
import { MAX_MARKDOWN_CHARS } from "./format";
import type { McpPrincipal } from "./principal";
import { createMcpServer } from "./tools";

vi.mock("@/db", () => ({ db: {} }));

const collab = vi.hoisted(() => ({
  readPage: vi.fn(),
  replaceContent: vi.fn(),
  appendContent: vi.fn(),
  setTitle: vi.fn(),
  restoreSnapshot: vi.fn(),
  broadcast: vi.fn(),
}));
vi.mock("@/server/collab/bridge", () => ({ getCollab: () => collab }));

const pages = vi.hoisted(() => ({
  getPage: vi.fn(),
  getBreadcrumbs: vi.fn(),
  listWorkspaces: vi.fn(),
  listChildren: vi.fn(),
  createPage: vi.fn(),
  renamePage: vi.fn(),
  archivePage: vi.fn(),
  searchPages: vi.fn(),
}));
vi.mock("@/server/pages", () => pages);
vi.mock("@/server/databases", () => ({ getDatabase: vi.fn(), listRows: vi.fn(), updateRowProperties: vi.fn(), addProperty: vi.fn() }));

const page = {
  id: "page-1",
  workspaceId: "ws-1",
  parentId: null,
  kind: "page",
  title: "Plan",
  icon: null,
  properties: {},
  archivedAt: null,
  updatedAt: new Date("2026-09-01T00:00:00Z"),
};

const writer: McpPrincipal = { userId: "user-1", clientId: "client-1", scopes: ["pages:read", "pages:write"] };
const reader: McpPrincipal = { userId: "user-1", clientId: "client-1", scopes: ["pages:read"] };

/** Calls one tool over an in-memory 2025-era session. */
async function callTool(principal: McpPrincipal, name: string, args: Record<string, unknown>) {
  const server = createMcpServer(principal);
  const [client, serverSide] = InMemoryTransport.createLinkedPair();
  const inbox: JSONRPCMessage[] = [];
  client.onmessage = (m) => void inbox.push(m);
  await server.connect(serverSide);
  await client.start();
  const waitFor = async (id: number) => {
    for (let i = 0; i < 200; i++) {
      const hit = inbox.find((m) => "id" in m && m.id === id);
      if (hit) return hit as { result?: any; error?: any };
      await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error(`no response for ${id}`);
  };
  await client.send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } },
  });
  await waitFor(1);
  await client.send({ jsonrpc: "2.0", method: "notifications/initialized" });
  await client.send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: args } });
  const response = await waitFor(2);
  await server.close();
  const result = response.result as { isError?: boolean; content: { text: string }[] };
  const text = result.content[0].text;
  return { isError: Boolean(result.isError), text, data: result.isError ? null : JSON.parse(text) };
}

beforeEach(() => {
  vi.clearAllMocks();
  pages.getPage.mockResolvedValue(page);
  pages.getBreadcrumbs.mockResolvedValue([{ id: "page-1", title: "Plan", icon: null, kind: "page" }]);
  pages.listWorkspaces.mockResolvedValue([{ id: "ws-1", name: "Team", icon: null, role: "owner" }]);
  pages.listChildren.mockResolvedValue([]);
  collab.readPage.mockResolvedValue({ title: "Plan", markdown: "Hello", text: "Hello" });
});

describe("content writes", () => {
  it("replace snapshots first and attributes the write to the OAuth client", async () => {
    const r = await callTool(writer, "update_page", { page_id: "page-1", markdown: "# New" });
    expect(r.isError).toBe(false);
    expect(collab.replaceContent).toHaveBeenCalledWith("page-1", "# New", { userId: "user-1", oauthClientId: "client-1" }, true);
    expect(r.data.url).toBe("http://localhost:3000/w/ws-1/p/page-1");
  });

  it("append snapshots first too", async () => {
    await callTool(writer, "update_page", { page_id: "page-1", markdown: "- more", mode: "append" });
    expect(collab.appendContent).toHaveBeenCalledWith("page-1", "- more", expect.anything(), true);
    expect(collab.replaceContent).not.toHaveBeenCalled();
  });

  it("refuses to write into trashed pages", async () => {
    pages.getPage.mockResolvedValue({ ...page, archivedAt: new Date() });
    const r = await callTool(writer, "update_page", { page_id: "page-1", markdown: "x" });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/trash/);
    expect(collab.replaceContent).not.toHaveBeenCalled();
  });

  it("read-only tokens cannot write even without an HTTP scope challenge", async () => {
    const r = await callTool(reader, "create_page", { workspace_id: "ws-1", title: "Nope" });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/read-only/);
    expect(pages.createPage).not.toHaveBeenCalled();
  });
});

describe("errors and bounds", () => {
  it("turns access errors into actionable tool errors", async () => {
    pages.getPage.mockRejectedValue(new AccessError());
    const r = await callTool(reader, "get_page", { page_id: "missing" });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/Not found or access denied.*search/);
  });

  it("hides unexpected errors", async () => {
    pages.searchPages.mockRejectedValue(new Error('relation "page" does not exist'));
    const r = await callTool(reader, "search", { query: "x" });
    expect(r.isError).toBe(true);
    expect(r.text).not.toMatch(/relation/);
  });

  it("truncates long bodies and says how to continue", async () => {
    collab.readPage.mockResolvedValue({ title: "Plan", markdown: "a".repeat(MAX_MARKDOWN_CHARS + 10), text: "" });
    const r = await callTool(reader, "get_page", { page_id: "page-1" });
    expect(r.data.markdown).toHaveLength(MAX_MARKDOWN_CHARS);
    expect(r.data.markdown_truncated).toBe(true);
    expect(r.data.note).toMatch(`offset=${MAX_MARKDOWN_CHARS}`);
    expect(r.data.path).toBe("Team / Plan");
  });
});

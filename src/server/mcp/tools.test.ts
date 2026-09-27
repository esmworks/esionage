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
  movePage: vi.fn(),
  recentPages: vi.fn(),
  listTrash: vi.fn(),
  restorePage: vi.fn(),
  listSnapshots: vi.fn(),
  getSnapshot: vi.fn(),
  restoreSnapshot: vi.fn(),
}));
vi.mock("@/server/pages", () => pages);

const databases = vi.hoisted(() => ({
  getDatabase: vi.fn(),
  listRows: vi.fn(),
  updateRowProperties: vi.fn(),
  updateRowsProperties: vi.fn(),
  createRows: vi.fn(),
  addProperty: vi.fn(),
  updateProperty: vi.fn(),
  deleteProperty: vi.fn(),
  addView: vi.fn(),
  updateView: vi.fn(),
  getLookups: vi.fn(async () => ({ relations: {}, people: [] })),
  makeOption: vi.fn((name: string, index: number) => ({ id: `opt-new-${index}`, name: name.trim(), color: "gray" })),
}));
vi.mock("@/server/databases", () => databases);

const pageHistory = vi.hoisted(() => ({ diffSnapshot: vi.fn() }));
vi.mock("@/server/page-history", () => pageHistory);

const workspaces = vi.hoisted(() => ({ listMembers: vi.fn() }));
vi.mock("@/server/workspaces", () => workspaces);

const notifications = vi.hoisted(() => ({ listNotifications: vi.fn() }));
vi.mock("@/server/notifications", () => notifications);

const mentions = vi.hoisted(() => ({
  labelPageLinks: vi.fn(async (_userId: string, markdown: string) => markdown),
  listBacklinks: vi.fn(async () => []),
}));
vi.mock("@/server/mentions", () => mentions);

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

const status = {
  id: "prop-status",
  name: "Status",
  type: "select",
  options: {
    options: [
      { id: "opt-todo", name: "Todo", color: "gray" },
      { id: "opt-done", name: "Done", color: "green" },
    ],
  },
};
const notes = { id: "prop-notes", name: "Notes", type: "text", options: {} };
const database = {
  database: { id: "db-1", workspaceId: "ws-1", kind: "database", title: "Tasks", archivedAt: null },
  properties: [status, notes],
  views: [{ id: "view-1", name: "Board", type: "board", config: { groupBy: "prop-status", sorts: [{ propertyId: "title", direction: "asc" }] } }],
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
  databases.getDatabase.mockResolvedValue(database);
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

describe("move_page", () => {
  it("refuses to move a page inside its own sub-tree", async () => {
    pages.getPage.mockImplementation(async (_: string, id: string) => (id === "child" ? { ...page, id: "child", parentId: "page-1" } : page));
    pages.getBreadcrumbs.mockResolvedValue([{ id: "page-1" }, { id: "child" }]);
    const r = await callTool(writer, "move_page", { page_id: "page-1", parent_id: "child" });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/inside itself/);
    expect(pages.movePage).not.toHaveBeenCalled();
  });

  it("refuses to move across workspaces", async () => {
    pages.getPage.mockImplementation(async (_: string, id: string) => (id === "other" ? { ...page, id: "other", workspaceId: "ws-2" } : page));
    const r = await callTool(writer, "move_page", { page_id: "page-1", parent_id: "other" });
    expect(r.text).toMatch(/another workspace/);
    expect(pages.movePage).not.toHaveBeenCalled();
  });

  it("moves to the top level with parent_id null and says when a row leaves its database", async () => {
    pages.getPage.mockImplementation(async (_: string, id: string) =>
      id === "db-1" ? { ...page, id: "db-1", kind: "database" } : { ...page, parentId: "db-1" },
    );
    const r = await callTool(writer, "move_page", { page_id: "page-1", parent_id: null });
    expect(pages.movePage).toHaveBeenCalledWith("user-1", "page-1", null);
    expect(r.data.parent_id).toBeNull();
    expect(r.data.note).toMatch(/no longer a database row/);
  });
});

describe("database properties", () => {
  it("renames, removes and adds options without changing kept option ids", async () => {
    const r = await callTool(writer, "update_database_property", {
      database_id: "db-1",
      property: "status",
      name: "State",
      rename_options: [{ from: "todo", to: "To do" }],
      remove_options: ["Done"],
      add_options: ["Blocked", "to do"],
    });
    expect(r.isError).toBe(false);
    expect(databases.updateProperty).toHaveBeenCalledWith("user-1", "prop-status", {
      name: "State",
      options: [
        { id: "opt-todo", name: "To do", color: "gray" },
        { id: "opt-new-1", name: "Blocked", color: "gray" },
      ],
    });
    expect(r.data.property).toEqual({ id: "prop-status", name: "State", type: "select", options: ["To do", "Blocked"] });
  });

  it("adds status options to groups and moves them between groups", async () => {
    const stage = {
      id: "prop-stage",
      name: "Stage",
      type: "status",
      options: {
        options: [
          { id: "s-new", name: "New", color: "gray", group: "todo" },
          { id: "s-done", name: "Shipped", color: "green", group: "done" },
        ],
      },
    };
    databases.getDatabase.mockResolvedValueOnce({ database: { id: "db-1", workspaceId: "ws-1" }, properties: [stage], views: [] });
    const r = await callTool(writer, "update_database_property", {
      database_id: "db-1",
      property: "Stage",
      add_options: [{ name: "Review", group: "in_progress" }, "Idea"],
      option_groups: [{ option: "shipped", group: "in_progress" }],
    });
    expect(r.isError).toBe(false);
    expect(databases.updateProperty.mock.calls[0][2].options.map((o: { name: string; group: string }) => [o.name, o.group])).toEqual([
      ["New", "todo"],
      ["Idea", "todo"],
      ["Shipped", "in_progress"],
      ["Review", "in_progress"],
    ]);
    expect(r.data.property.status_groups).toEqual({ todo: ["New", "Idea"], in_progress: ["Shipped", "Review"], done: [] });
    const wrong = await callTool(writer, "update_database_property", {
      database_id: "db-1",
      property: "Status",
      option_groups: [{ option: "Todo", group: "done" }],
    });
    expect(wrong.text).toMatch(/only status options belong to groups/);
  });

  it("names the existing options when one is unknown", async () => {
    const r = await callTool(writer, "update_database_property", { database_id: "db-1", property: "Status", remove_options: ["Later"] });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/Options: Todo, Done/);
    expect(databases.updateProperty).not.toHaveBeenCalled();
  });

  it("rejects option changes on non-select properties and duplicate names", async () => {
    const opts = await callTool(writer, "update_database_property", { database_id: "db-1", property: "Notes", add_options: ["x"] });
    expect(opts.text).toMatch(/only select, multi_select and status/);
    const dup = await callTool(writer, "update_database_property", { database_id: "db-1", property: "Notes", name: "status" });
    expect(dup.text).toMatch(/already exists/);
    expect(databases.updateProperty).not.toHaveBeenCalled();
  });

  it("deletes by name, and read-only tokens cannot", async () => {
    const denied = await callTool(reader, "delete_database_property", { database_id: "db-1", property: "Notes" });
    expect(denied.text).toMatch(/read-only/);
    const r = await callTool(writer, "delete_database_property", { database_id: "db-1", property: "notes" });
    expect(databases.deleteProperty).toHaveBeenCalledWith("user-1", "prop-notes");
    expect(r.data.deleted.name).toBe("Notes");
  });
});

describe("relations and calendars", () => {
  it("needs a related database for a relation and passes the two-way settings", async () => {
    const missing = await callTool(writer, "add_database_property", { database_id: "db-1", name: "Customer", type: "relation" });
    expect(missing.text).toMatch(/related_database_id/);
    const misplaced = await callTool(writer, "add_database_property", {
      database_id: "db-1",
      name: "Due",
      type: "date",
      related_database_id: "db-2",
    });
    expect(misplaced.text).toMatch(/only apply to relation/);
    databases.addProperty.mockResolvedValue({
      id: "prop-customer",
      name: "Customer",
      type: "relation",
      options: { relation: { databaseId: "db-2", pairedPropertyId: "prop-jobs" } },
    });
    const r = await callTool(writer, "add_database_property", {
      database_id: "db-1",
      name: "Customer",
      type: "relation",
      related_database_id: "db-2",
      two_way: true,
      paired_property_name: "Jobs",
    });
    expect(databases.addProperty).toHaveBeenCalledWith("user-1", "db-1", {
      name: "Customer",
      type: "relation",
      options: undefined,
      relation: { databaseId: "db-2", twoWay: true, pairedName: "Jobs" },
    });
    expect(r.data.property).toMatchObject({ related_database_id: "db-2", two_way: true });
  });

  it("creates timelines with start, end, swimlanes and zoom, and checks each setting's view type", async () => {
    const due = { id: "prop-due", name: "Due", type: "date", options: {} };
    const starts = { id: "prop-start", name: "Starts", type: "date", options: {} };
    databases.getDatabase.mockResolvedValue({ ...database, properties: [status, notes, due, starts] });
    const onGallery = await callTool(writer, "create_database_view", { database_id: "db-1", name: "G", type: "gallery", zoom: "day" });
    expect(onGallery.text).toMatch(/zoom only applies to timeline/);
    const badEnd = await callTool(writer, "create_database_view", { database_id: "db-1", name: "T", type: "timeline", end_date_by: "Notes" });
    expect(badEnd.text).toMatch(/end at a date property/);
    expect(databases.addView).not.toHaveBeenCalled();
    databases.addView.mockResolvedValue({ id: "view-4", name: "Plan", type: "timeline", config: { dateBy: "prop-due" } });
    const r = await callTool(writer, "create_database_view", {
      database_id: "db-1",
      name: "Plan",
      type: "timeline",
      date_by: "Starts",
      end_date_by: "Due",
      group_by: "Status",
      zoom: "month",
    });
    expect(databases.updateView).toHaveBeenCalledWith("user-1", "view-4", {
      config: { dateBy: "prop-start", endDateBy: "prop-due", groupBy: "prop-status", zoom: "month" },
    });
    expect(r.data).toMatchObject({ type: "timeline", date_by: "Starts", end_date_by: "Due", group_by: "Status", zoom: "month" });
  });

  it("removes timeline swimlanes with a null group_by and sets gallery cards", async () => {
    const views = [
      { id: "view-t", name: "Plan", type: "timeline", config: { dateBy: "prop-due", groupBy: "prop-status" } },
      { id: "view-g", name: "Cards", type: "gallery", config: {} },
    ];
    databases.getDatabase.mockResolvedValue({ ...database, views });
    await callTool(writer, "update_database_view", { database_id: "db-1", view_id: "view-t", group_by: null });
    expect(databases.updateView).toHaveBeenLastCalledWith("user-1", "view-t", { config: { dateBy: "prop-due", groupBy: undefined } });
    const r = await callTool(writer, "update_database_view", { database_id: "db-1", view_id: "view-g", card_size: "large", cover: "none" });
    expect(databases.updateView).toHaveBeenLastCalledWith("user-1", "view-g", {
      config: { cardSize: "large", cover: { source: "none" } },
    });
    expect(r.data).toMatchObject({ card_size: "large", cover: "none" });
  });

  it("creates charts with a calculation, stacking and sort, and checks each setting", async () => {
    const amount = { id: "prop-amount", name: "Amount", type: "number", options: {} };
    const done = { id: "prop-done", name: "Done", type: "checkbox", options: {} };
    databases.getDatabase.mockResolvedValue({ ...database, properties: [status, notes, amount, done] });
    const onTable = await callTool(writer, "create_database_view", { database_id: "db-1", name: "T", type: "table", chart_type: "line" });
    expect(onTable.text).toMatch(/chart_type only applies to chart views/);
    const noProperty = await callTool(writer, "create_database_view", { database_id: "db-1", name: "C", type: "chart", aggregate: "sum" });
    expect(noProperty.text).toMatch(/needs aggregate_property/);
    const wrongType = await callTool(writer, "create_database_view", {
      database_id: "db-1",
      name: "C",
      type: "chart",
      aggregate: "sum",
      aggregate_property: "Notes",
    });
    expect(wrongType.text).toMatch(/can't calculate sum over "Notes"/);
    const averageStack = await callTool(writer, "create_database_view", {
      database_id: "db-1",
      name: "C",
      type: "chart",
      aggregate: "average",
      aggregate_property: "Amount",
      stack_by: "Done",
    });
    expect(averageStack.text).toMatch(/stack_by only applies to bar and horizontal_bar charts/);
    expect(databases.addView).not.toHaveBeenCalled();

    databases.addView.mockResolvedValue({ id: "view-c", name: "Spend", type: "chart", config: { groupBy: "prop-status" } });
    const r = await callTool(writer, "create_database_view", {
      database_id: "db-1",
      name: "Spend",
      type: "chart",
      chart_type: "horizontal_bar",
      aggregate: "sum",
      aggregate_property: "Amount",
      stack_by: "Done",
      chart_sort: "value_desc",
      show_values: true,
    });
    expect(databases.updateView).toHaveBeenCalledWith("user-1", "view-c", {
      config: {
        groupBy: "prop-status",
        chartType: "horizontal_bar",
        chartAggregate: { fn: "sum", propertyId: "prop-amount" },
        stackBy: "prop-done",
        chartSort: "value_desc",
        showValues: true,
      },
    });
    expect(r.data).toMatchObject({
      type: "chart",
      group_by: "Status",
      chart_type: "horizontal_bar",
      aggregate: "sum",
      aggregate_property: "Amount",
      stack_by: "Done",
      chart_sort: "value_desc",
      show_values: true,
    });
  });

  it("updates a chart's calculation one part at a time and goes back to counting rows", async () => {
    const amount = { id: "prop-amount", name: "Amount", type: "number", options: {} };
    const views = [
      { id: "view-c", name: "Spend", type: "chart", config: { groupBy: "prop-status", chartAggregate: { fn: "sum", propertyId: "prop-amount" } } },
    ];
    databases.getDatabase.mockResolvedValue({ ...database, properties: [status, notes, amount], views });
    await callTool(writer, "update_database_view", { database_id: "db-1", view_id: "view-c", aggregate: "median" });
    expect(databases.updateView).toHaveBeenLastCalledWith("user-1", "view-c", {
      config: { groupBy: "prop-status", chartAggregate: { fn: "median", propertyId: "prop-amount" } },
    });
    const r = await callTool(writer, "update_database_view", { database_id: "db-1", view_id: "view-c", aggregate: "count", chart_type: "donut" });
    expect(databases.updateView).toHaveBeenLastCalledWith("user-1", "view-c", {
      config: { groupBy: "prop-status", chartAggregate: undefined, chartType: "donut" },
    });
    expect(r.data).toMatchObject({ chart_type: "donut", aggregate: "count", show_legend: true });
    expect(r.data).not.toHaveProperty("aggregate_property");
    const ungrouped = await callTool(writer, "update_database_view", { database_id: "db-1", view_id: "view-c", group_by: null });
    expect(ungrouped.text).toMatch(/Charts always group/);
  });

  it("returns what a chart view plots with its rows", async () => {
    const views = [{ id: "view-c", name: "Chart", type: "chart", config: { groupBy: "prop-status", filters: [] } }];
    databases.getDatabase.mockResolvedValue({ ...database, views });
    databases.listRows.mockResolvedValue([
      { id: "r1", title: "A", properties: { "prop-status": "opt-done" } },
      { id: "r2", title: "B", properties: { "prop-status": "opt-done" } },
      { id: "r3", title: "C", properties: {} },
    ]);
    const r = await callTool(reader, "query_database", { database_id: "db-1", view_id: "view-c", limit: 1 });
    expect(r.data.returned).toBe(1);
    expect(r.data.chart).toMatchObject({
      chart_type: "bar",
      aggregate: "count",
      group_by: "Status",
      format: "number",
      series: [
        { group: "Todo", value: 0, row_count: 0 },
        { group: "Done", value: 2, row_count: 2 },
        { group: "No Status", value: 1, row_count: 1 },
      ],
    });
  });

  it("creates calendar views on a date property only", async () => {
    const due = { id: "prop-due", name: "Due", type: "date", options: {} };
    databases.getDatabase.mockResolvedValue({ ...database, properties: [status, notes, due] });
    const wrong = await callTool(writer, "create_database_view", { database_id: "db-1", name: "Cal", type: "calendar", date_by: "Notes" });
    expect(wrong.text).toMatch(/date property/);
    const onBoard = await callTool(writer, "create_database_view", { database_id: "db-1", name: "B", type: "board", date_by: "Due" });
    expect(onBoard.text).toMatch(/only applies to calendar/);
    expect(databases.addView).not.toHaveBeenCalled();
    databases.addView.mockResolvedValue({ id: "view-3", name: "Cal", type: "calendar", config: { dateBy: "prop-due" } });
    const r = await callTool(writer, "create_database_view", { database_id: "db-1", name: "Cal", type: "calendar" });
    expect(databases.addView).toHaveBeenCalledWith("user-1", "db-1", { name: "Cal", type: "calendar" });
    expect(r.data).toMatchObject({ type: "calendar", date_by: "Due" });
  });
});

describe("create_database_rows", () => {
  it("adds the rows in one call and writes their bodies", async () => {
    databases.createRows.mockResolvedValue([
      { id: "row-1", title: "Acme" },
      { id: "row-2", title: "Globex" },
    ]);
    const rows = [
      { title: "Acme", properties: { Status: "Todo" }, markdown: "# Notes" },
      { title: "Globex", properties: { Status: "Done" } },
    ];
    const r = await callTool(writer, "create_database_rows", { database_id: "db-1", rows });
    expect(r.isError).toBe(false);
    expect(databases.createRows).toHaveBeenCalledWith("user-1", "db-1", rows);
    expect(collab.replaceContent).toHaveBeenCalledTimes(1);
    expect(collab.replaceContent).toHaveBeenCalledWith("row-1", "# Notes", { userId: "user-1", oauthClientId: "client-1" });
    expect(r.data).toMatchObject({
      created: 2,
      rows: [
        { id: "row-1", title: "Acme", url: "http://localhost:3000/w/ws-1/p/row-1" },
        { id: "row-2", title: "Globex" },
      ],
    });
  });

  it("refuses read-only tokens, empty and oversized batches", async () => {
    const readOnly = await callTool(reader, "create_database_rows", { database_id: "db-1", rows: [{ title: "A" }] });
    expect(readOnly.text).toMatch(/read-only/);
    const empty = await callTool(writer, "create_database_rows", { database_id: "db-1", rows: [] });
    expect(empty.isError).toBe(true);
    const rows = Array.from({ length: 101 }, (_, i) => ({ title: `Row ${i}` }));
    const tooMany = await callTool(writer, "create_database_rows", { database_id: "db-1", rows });
    expect(tooMany.isError).toBe(true);
    expect(databases.createRows).not.toHaveBeenCalled();
  });
});

describe("update_database_rows", () => {
  it("sets the values on every row and lists the rows it skipped", async () => {
    databases.updateRowsProperties.mockResolvedValue({ done: ["row-1"], skipped: ["row-2"] });
    const r = await callTool(writer, "update_database_rows", {
      database_id: "db-1",
      row_ids: ["row-1", "row-2"],
      properties: { Status: "Done" },
    });
    expect(r.isError).toBe(false);
    expect(databases.updateRowsProperties).toHaveBeenCalledWith("user-1", "db-1", ["row-1", "row-2"], { Status: "Done" });
    expect(r.data).toMatchObject({ updated: 1, skipped_row_ids: ["row-2"], url: "http://localhost:3000/w/ws-1/p/db-1" });
  });

  it("leaves skipped_row_ids out when every row changed", async () => {
    databases.updateRowsProperties.mockResolvedValue({ done: ["row-1"], skipped: [] });
    const r = await callTool(writer, "update_database_rows", { database_id: "db-1", row_ids: ["row-1"], properties: { Notes: null } });
    expect(r.data).toEqual({ database_id: "db-1", updated: 1, url: "http://localhost:3000/w/ws-1/p/db-1" });
  });

  it("refuses read-only tokens, empty changes, trashed databases and oversized batches", async () => {
    const readOnly = await callTool(reader, "update_database_rows", { database_id: "db-1", row_ids: ["r"], properties: { Status: "Done" } });
    expect(readOnly.text).toMatch(/read-only/);
    const empty = await callTool(writer, "update_database_rows", { database_id: "db-1", row_ids: ["r"], properties: {} });
    expect(empty.text).toMatch(/at least one property/);
    const tooMany = await callTool(writer, "update_database_rows", {
      database_id: "db-1",
      row_ids: Array.from({ length: 101 }, (_, i) => `row-${i}`),
      properties: { Status: "Done" },
    });
    expect(tooMany.isError).toBe(true);
    databases.getDatabase.mockResolvedValue({ ...database, database: { ...database.database, archivedAt: new Date() } });
    const trashed = await callTool(writer, "update_database_rows", { database_id: "db-1", row_ids: ["r"], properties: { Status: "Done" } });
    expect(trashed.text).toMatch(/trash/);
    expect(databases.updateRowsProperties).not.toHaveBeenCalled();
  });
});

describe("database views", () => {
  it("validates board grouping before creating the view", async () => {
    const r = await callTool(writer, "create_database_view", { database_id: "db-1", name: "By notes", type: "board", group_by: "Notes" });
    expect(r.text).toMatch(/Views group by a select, status, multi_select, .* or relation property; "Notes" is text/);
    expect(databases.addView).not.toHaveBeenCalled();
  });

  it("groups tables by date with a bucket size, and ungroups them", async () => {
    const due = { id: "prop-due", name: "Due", type: "date", options: {} };
    databases.getDatabase.mockResolvedValue({ ...database, properties: [status, notes, due] });
    const onCalendar = await callTool(writer, "create_database_view", { database_id: "db-1", name: "C", type: "calendar", group_by: "Due" });
    expect(onCalendar.text).toMatch(/only applies to board, table, timeline and chart/);
    const wrongProp = await callTool(writer, "create_database_view", {
      database_id: "db-1",
      name: "T",
      group_by: "Status",
      group_date_by: "week",
    });
    expect(wrongProp.text).toMatch(/group_date_by only applies when grouping by a date/);
    const ungroupBoard = await callTool(writer, "create_database_view", { database_id: "db-1", name: "B", type: "board", group_by: null });
    expect(ungroupBoard.isError).toBe(true);
    expect(databases.addView).not.toHaveBeenCalled();

    databases.addView.mockResolvedValue({ id: "view-4", name: "By week", type: "table", config: {} });
    const r = await callTool(writer, "create_database_view", {
      database_id: "db-1",
      name: "By week",
      group_by: "Due",
      group_date_by: "week",
      hide_empty_groups: true,
    });
    expect(databases.updateView).toHaveBeenCalledWith("user-1", "view-4", {
      config: { groupBy: "prop-due", groupDateBy: "week", hideEmptyGroups: true },
    });
    expect(r.data).toMatchObject({ type: "table", group_by: "Due", group_date_by: "week", hide_empty_groups: true });

    databases.getDatabase.mockResolvedValue({
      ...database,
      properties: [status, notes, due],
      views: [{ id: "view-4", name: "By week", type: "table", config: { groupBy: "prop-due", groupDateBy: "week" } }],
    });
    const cleared = await callTool(writer, "update_database_view", { database_id: "db-1", view_id: "view-4", group_by: null });
    expect(cleared.isError).toBe(false);
    expect(cleared.data.group_by).toBeUndefined();
    expect(databases.updateView).toHaveBeenLastCalledWith("user-1", "view-4", { config: { groupDateBy: "week" } });
  });

  it("creates a view with filters stored as option ids", async () => {
    databases.addView.mockResolvedValue({ id: "view-2", name: "Open", type: "table", config: {} });
    const r = await callTool(writer, "create_database_view", {
      database_id: "db-1",
      name: "Open",
      filters: [{ property: "Status", op: "not_equals", value: "done" }],
    });
    expect(databases.addView).toHaveBeenCalledWith("user-1", "db-1", { name: "Open", type: "table" });
    expect(databases.updateView).toHaveBeenCalledWith("user-1", "view-2", {
      config: { filters: [{ propertyId: "prop-status", op: "not_equals", value: "opt-done" }] },
    });
    expect(r.data.filters).toEqual([{ property: "Status", op: "not_equals", value: "Done" }]);
  });

  it("replaces only the settings it is given", async () => {
    await callTool(writer, "update_database_view", { database_id: "db-1", view_id: "view-1", sorts: [] });
    expect(databases.updateView).toHaveBeenCalledWith("user-1", "view-1", { config: { groupBy: "prop-status", sorts: [] } });
  });

  it("rejects unknown view ids", async () => {
    const r = await callTool(writer, "update_database_view", { database_id: "db-1", view_id: "nope", name: "X" });
    expect(r.text).toMatch(/No view with id/);
  });
});

describe("filter groups over MCP", () => {
  const done = { propertyId: "prop-status", op: "equals", value: "opt-done" };
  const todo = { propertyId: "prop-status", op: "equals", value: "opt-todo" };
  const noNotes = { propertyId: "prop-notes", op: "is_empty" };

  it("stores groups and the top-level combinator of a new view", async () => {
    databases.addView.mockResolvedValue({ id: "view-2", name: "Either", type: "table", config: {} });
    const r = await callTool(writer, "create_database_view", {
      database_id: "db-1",
      name: "Either",
      filter_combinator: "or",
      filters: [
        { property: "Status", op: "equals", value: "Done" },
        {
          type: "group",
          combinator: "and",
          rules: [
            { property: "Status", op: "equals", value: "Todo" },
            { type: "group", combinator: "or", rules: [{ property: "Notes", op: "is_empty" }] },
          ],
        },
      ],
    });
    expect(r.isError).toBe(false);
    expect(databases.updateView).toHaveBeenCalledWith("user-1", "view-2", {
      config: {
        filterCombinator: "or",
        filters: [done, { type: "group", combinator: "and", rules: [todo, { type: "group", combinator: "or", rules: [noNotes] }] }],
      },
    });
    expect(r.data.filter_combinator).toBe("or");
    expect(r.data.filters[1]).toEqual({
      type: "group",
      combinator: "and",
      rules: [
        { property: "Status", op: "equals", value: "Todo" },
        { type: "group", combinator: "or", rules: [{ property: "Notes", op: "is_empty" }] },
      ],
    });
  });

  it("rejects groups nested too deep and unknown ops with clear messages", async () => {
    const leaf = { property: "Notes", op: "is_empty" };
    const deep = await callTool(writer, "update_database_view", {
      database_id: "db-1",
      view_id: "view-1",
      filters: [{ type: "group", rules: [{ type: "group", rules: [{ type: "group", rules: [leaf] }] }] }],
    });
    expect(deep.isError).toBe(true);
    expect(deep.text).toMatch(/at most 2 levels deep/);
    const unknown = await callTool(writer, "query_database", {
      database_id: "db-1",
      filters: [{ property: "Notes", op: "matches", value: "x" }],
    });
    expect(unknown.isError).toBe(true);
    expect(unknown.text).toMatch(/filters\.0: op: Invalid option: expected one of .*"is_within"/);
    expect(databases.updateView).not.toHaveBeenCalled();
    expect(databases.listRows).not.toHaveBeenCalled();
  });

  it("switches only the combinator when that is all it is given", async () => {
    await callTool(writer, "update_database_view", { database_id: "db-1", view_id: "view-1", filter_combinator: "or" });
    expect(databases.updateView).toHaveBeenCalledWith("user-1", "view-1", {
      config: { groupBy: "prop-status", sorts: [{ propertyId: "title", direction: "asc" }], filterCombinator: "or" },
    });
  });

  it("queries with a saved view's filters and the caller's, each keeping its combinator", async () => {
    databases.getDatabase.mockResolvedValue({
      ...database,
      views: [{ id: "view-or", name: "Either", type: "table", config: { filterCombinator: "or", filters: [done, todo] } }],
    });
    databases.listRows.mockResolvedValue([]);
    await callTool(reader, "query_database", {
      database_id: "db-1",
      view_id: "view-or",
      filters: [{ property: "Notes", op: "is_empty" }],
    });
    expect(databases.listRows).toHaveBeenCalledWith("user-1", "db-1", {
      filters: [
        { type: "group", combinator: "or", rules: [done, todo] },
        { type: "group", combinator: "and", rules: [noNotes] },
      ],
      sorts: [],
    });
  });

  it("still accepts a plain list of rules", async () => {
    databases.listRows.mockResolvedValue([]);
    await callTool(reader, "query_database", {
      database_id: "db-1",
      filters: [{ property: "Status", op: "equals", value: "Done" }, { property: "Notes", op: "is_empty" }],
    });
    expect(databases.listRows).toHaveBeenCalledWith("user-1", "db-1", {
      filters: [{ type: "group", combinator: "and", rules: [done, noNotes] }],
      sorts: [],
    });
  });
});

describe("trash and history", () => {
  it("restore_page reports when the page lands at the top level", async () => {
    pages.getPage
      .mockResolvedValueOnce({ ...page, parentId: "gone", archivedAt: new Date() })
      .mockResolvedValueOnce({ ...page, parentId: null });
    const r = await callTool(writer, "restore_page", { page_id: "page-1" });
    expect(pages.restorePage).toHaveBeenCalledWith("user-1", "page-1");
    expect(r.data.note).toMatch(/top level/);
  });

  it("restore_page_version snapshots via the collab service and refuses trashed pages", async () => {
    pages.getSnapshot.mockResolvedValue({ id: "snap-1", pageId: "page-1", title: "Plan v1", contentMarkdown: "old", createdAt: new Date() });
    const ok = await callTool(writer, "restore_page_version", { version_id: "snap-1" });
    expect(pages.restoreSnapshot).toHaveBeenCalledWith({ userId: "user-1", oauthClientId: "client-1" }, "snap-1");
    expect(ok.data.url).toBe("http://localhost:3000/w/ws-1/p/page-1");

    pages.restoreSnapshot.mockClear();
    pages.getPage.mockResolvedValue({ ...page, archivedAt: new Date() });
    const trashed = await callTool(writer, "restore_page_version", { version_id: "snap-1" });
    expect(trashed.text).toMatch(/trash/);
    expect(pages.restoreSnapshot).not.toHaveBeenCalled();
  });

  it("list_page_history names the MCP client behind a change", async () => {
    pages.listSnapshots.mockResolvedValue([
      { id: "s1", title: "Plan", reason: "before_mcp_write", createdAt: new Date("2026-09-02T00:00:00Z"), authorName: "Erhan", clientName: "Claude" },
    ]);
    const r = await callTool(reader, "list_page_history", { page_id: "page-1" });
    expect(r.data.versions[0]).toMatchObject({ id: "s1", by: "Erhan via Claude", saved_at: "2026-09-02T00:00:00.000Z" });
  });

  it("diff_page_version prints the changes and who made them", async () => {
    const { diffBlocks, diffWords, flattenBlocks } = await import("@/lib/page-diff");
    const para = (text: string) => ({ type: "paragraph", props: {}, content: text });
    pageHistory.diffSnapshot.mockResolvedValue({
      against: "current",
      fromId: "s1",
      toId: null,
      title: diffWords("Plan", "Plan v2"),
      changes: diffBlocks(flattenBlocks([para("The quick fox")]), flattenBlocks([para("The slow fox"), para("New")])),
      actors: [{ name: "Erhan", client: "Claude" }],
    });
    const r = await callTool(reader, "diff_page_version", { version_id: "s1" });
    expect(pageHistory.diffSnapshot).toHaveBeenCalledWith("user-1", "s1", "current");
    expect(r.data).toMatchObject({
      from: "s1",
      to: "current",
      changed: true,
      title: "Plan{+ v2+}",
      changed_by: ["Erhan via Claude"],
      diff: "~ The [-quick-]{+slow+} fox\n+ New",
    });

    pageHistory.diffSnapshot.mockResolvedValue(null);
    const oldest = await callTool(reader, "diff_page_version", { version_id: "s1", against: "previous" });
    expect(oldest.data.note).toMatch(/oldest/);
  });
});

describe("workspace reads", () => {
  it("list_users marks the connected user", async () => {
    workspaces.listMembers.mockResolvedValue([
      { userId: "user-1", name: "Erhan", email: "e@example.com", role: "owner" },
      { userId: "user-2", name: "Ada", email: "a@example.com", role: "member" },
    ]);
    const r = await callTool(reader, "list_users", { workspace_id: "ws-1" });
    expect(r.data.users.map((u: { is_you: boolean }) => u.is_you)).toEqual([true, false]);
  });
});

describe("list_notifications", () => {
  const inbox = [
    {
      id: "n-2",
      kind: "page_shared",
      workspaceId: "ws-1",
      workspaceName: "Team",
      createdAt: new Date("2026-09-02T00:00:00Z"),
      read: false,
      actorName: "Ada",
      pageId: "page-1",
      pageTitle: "Plan",
      pageIcon: null,
      databaseTitle: null,
      propertyName: null,
    },
    {
      id: "n-1",
      kind: "assignment",
      workspaceId: "ws-1",
      workspaceName: "Team",
      createdAt: new Date("2026-09-01T00:00:00Z"),
      read: true,
      actorName: null,
      pageId: "row-1",
      pageTitle: "",
      pageIcon: null,
      databaseTitle: "Tasks",
      propertyName: "Owner",
    },
  ];

  it("lists the inbox with a summary and link for each kind", async () => {
    notifications.listNotifications.mockResolvedValue(inbox);
    const principal = { ...reader, scopes: ["pages:read", "notifications:read"] };
    const { isError, data } = await callTool(principal, "list_notifications", { workspace_id: "ws-1", unread_only: true });
    expect(isError).toBe(false);
    expect(notifications.listNotifications).toHaveBeenCalledWith("user-1", { workspaceId: "ws-1", unreadOnly: true, limit: 20 });
    expect(data.notifications[0]).toMatchObject({
      kind: "page_shared",
      read: false,
      summary: 'Ada shared "Plan" with the user',
      url: expect.stringMatching(/\/w\/ws-1\/p\/page-1$/),
    });
    expect(data.notifications[0]).not.toHaveProperty("property");
    expect(data.notifications[1]).toMatchObject({
      kind: "assignment",
      summary: 'Someone assigned the user to "Owner" on "Untitled" in Tasks',
      database: "Tasks",
      property: "Owner",
    });
  });

  it("needs the notifications:read scope", async () => {
    const { isError, text } = await callTool(writer, "list_notifications", {});
    expect(isError).toBe(true);
    expect(text).toMatch(/notifications:read/);
    expect(notifications.listNotifications).not.toHaveBeenCalled();
  });
});

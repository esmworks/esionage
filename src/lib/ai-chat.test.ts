import { describe, expect, it } from "vitest";
import { groupConversations } from "./ai-chat";

describe("conversation groups", () => {
  // Local time, as the person's sidebar sees it.
  const now = new Date(2026, 9, 1, 9, 30);
  const at = (month: number, day: number, hour = 12) => new Date(2026, month, day, hour).toISOString();

  it("puts conversations under today, yesterday, the last 7 and 30 days and older", () => {
    const list = [
      { id: "a", updatedAt: at(9, 1, 0) },
      { id: "b", updatedAt: at(8, 30, 23) },
      { id: "c", updatedAt: at(8, 30, 0) },
      { id: "d", updatedAt: at(8, 24, 0) },
      { id: "e", updatedAt: at(8, 23, 23) },
      { id: "f", updatedAt: at(8, 1, 0) },
      { id: "g", updatedAt: at(7, 31, 23) },
    ];
    expect(groupConversations(list, now).map((g) => [g.group, g.conversations.map((c) => c.id)])).toEqual([
      ["today", ["a"]],
      ["yesterday", ["b", "c"]],
      ["week", ["d"]],
      ["month", ["e", "f"]],
      ["older", ["g"]],
    ]);
  });

  it("leaves out empty groups", () => {
    expect(groupConversations([{ updatedAt: at(5, 1) }], now).map((g) => g.group)).toEqual(["older"]);
    expect(groupConversations([], now)).toEqual([]);
  });
});

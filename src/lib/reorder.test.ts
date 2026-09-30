import { describe, expect, it } from "vitest";
import { moveBeside } from "./reorder";

describe("moveBeside", () => {
  const ids = ["a", "b", "c", "d"];

  it("moves an id before or after another", () => {
    expect(moveBeside(ids, "d", "a", "before")).toEqual(["d", "a", "b", "c"]);
    expect(moveBeside(ids, "a", "c", "after")).toEqual(["b", "c", "a", "d"]);
  });

  it("changes nothing for a drop on itself or with an unknown id", () => {
    expect(moveBeside(ids, "b", "b", "after")).toEqual(ids);
    expect(moveBeside(ids, "b", "x", "before")).toEqual(ids);
    expect(moveBeside(ids, "x", "b", "before")).toEqual(ids);
  });
});

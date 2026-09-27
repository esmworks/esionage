import { describe, expect, it } from "vitest";
import { cleanGroupName, GroupError, MAX_GROUP_NAME } from "./groups";

describe("cleanGroupName", () => {
  it("trims and collapses whitespace", () => {
    expect(cleanGroupName("  Design \n  team ")).toBe("Design team");
  });

  it("keeps at most MAX_GROUP_NAME characters, without a trailing space", () => {
    const long = `${"a".repeat(MAX_GROUP_NAME - 1)} bcd`;
    const clean = cleanGroupName(long);
    expect(clean.length).toBeLessThanOrEqual(MAX_GROUP_NAME);
    expect(clean).toBe("a".repeat(MAX_GROUP_NAME - 1));
  });

  it("refuses empty names and non-strings with a translatable code", () => {
    for (const value of ["", "   ", undefined, null, 42]) {
      try {
        cleanGroupName(value);
        expect.unreachable(`accepted ${String(value)}`);
      } catch (error) {
        expect(error).toBeInstanceOf(GroupError);
        expect((error as GroupError).code).toBe("nameRequired");
      }
    }
  });
});

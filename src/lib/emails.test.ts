import { describe, expect, it } from "vitest";
import { isEmail, parseEmailList } from "./emails";

describe("parseEmailList", () => {
  it("splits on commas, semicolons, spaces and new lines", () => {
    expect(parseEmailList("a@x.com, b@x.com;c@x.com\nd@x.com  e@x.com")).toEqual([
      "a@x.com",
      "b@x.com",
      "c@x.com",
      "d@x.com",
      "e@x.com",
    ]);
  });

  it("lowercases and removes duplicates", () => {
    expect(parseEmailList("Ayşe@X.com, ayşe@x.com")).toEqual(["ayşe@x.com"]);
  });

  it("returns nothing for blank input", () => {
    expect(parseEmailList(" ,\n; ")).toEqual([]);
  });
});

describe("isEmail", () => {
  it("accepts ordinary addresses", () => {
    expect(isEmail("erhan@example.com")).toBe(true);
    expect(isEmail("first.last+tag@sub.example.co")).toBe(true);
  });

  it("rejects things that are not addresses", () => {
    for (const value of ["", "erhan", "erhan@", "@example.com", "erhan@example", "a b@example.com"]) {
      expect(isEmail(value), value).toBe(false);
    }
  });
});

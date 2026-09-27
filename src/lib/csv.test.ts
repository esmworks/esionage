import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "./csv";

describe("csvCell", () => {
  it("leaves plain text alone", () => {
    expect(csvCell("Erhan Erbaş")).toBe("Erhan Erbaş");
  });

  it("quotes commas, quotes and new lines", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
  });

  it("defuses cells a spreadsheet would run as a formula", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe('"\'=HYPERLINK(""x"")"');
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("-2")).toBe("'-2");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
  });

  it("writes dates as ISO and empties as nothing", () => {
    expect(csvCell(new Date("2026-09-27T10:00:00Z"))).toBe("2026-09-27T10:00:00.000Z");
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });
});

describe("toCsv", () => {
  it("joins rows with CRLF after a BOM", () => {
    expect(toCsv([["a", "b"], ["c", "d"]])).toBe("﻿a,b\r\nc,d\r\n");
  });
});

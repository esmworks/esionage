import { en as editorEn } from "@blocknote/core/locales";
import { describe, expect, it } from "vitest";
import { tr as editorTr } from "./blocknote/tr";
import { negotiateLocale, requestLocale } from "./config";
import { emailMessages } from "./messages/email";
import en from "./messages/en";
import tr from "./messages/tr";

type Tree = { [key: string]: unknown };

/** Every leaf key path, plus the ICU arguments its message uses (`{name}` or `{name, plural, …}`). */
function leaves(tree: unknown, prefix = ""): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (typeof tree === "string") {
    out.set(prefix, [...new Set([...tree.matchAll(/\{\s*(\w+)\s*[,}]/g)].map((m) => m[1]))].sort());
    return out;
  }
  // Arrays (e.g. slash-menu search aliases) are one leaf: each language may list its own terms.
  if (Array.isArray(tree) || typeof tree === "function" || tree === null || typeof tree !== "object") {
    out.set(prefix, []);
    return out;
  }
  for (const [key, value] of Object.entries(tree as Tree)) {
    for (const [path, vars] of leaves(value, prefix ? `${prefix}.${key}` : key)) out.set(path, vars);
  }
  return out;
}

describe("translations", () => {
  it("Turkish has exactly the English message keys and placeholders", () => {
    const a = leaves(en);
    const b = leaves(tr);
    expect([...b.keys()].sort()).toEqual([...a.keys()].sort());
    for (const [path, vars] of a) expect(b.get(path), path).toEqual(vars);
  });

  it("Turkish emails have exactly the English keys and placeholders", () => {
    const a = leaves(emailMessages.en);
    const b = leaves(emailMessages.tr);
    expect([...b.keys()].sort()).toEqual([...a.keys()].sort());
    for (const [path, vars] of a) expect(b.get(path), path).toEqual(vars);
  });

  it("the Turkish editor dictionary covers every BlockNote key", () => {
    expect([...leaves(editorTr).keys()].sort()).toEqual([...leaves(editorEn).keys()].sort());
  });

  it("negotiates the language from Accept-Language", () => {
    expect(negotiateLocale("tr-TR,tr;q=0.9,en;q=0.8")).toBe("tr");
    expect(negotiateLocale("de-DE,de;q=0.9,tr;q=0.5")).toBe("tr");
    expect(negotiateLocale("de-DE")).toBe("en");
    expect(negotiateLocale(null)).toBe("en");
    expect(negotiateLocale("en;q=0.2,tr;q=0.8")).toBe("tr");
  });

  it("prefers the saved language over Accept-Language for requests", () => {
    const headers = (init: Record<string, string>) => new Headers(init);
    expect(requestLocale(headers({ "accept-language": "tr-TR" }))).toBe("tr");
    expect(requestLocale(headers({ cookie: "TZ=Europe%2FIstanbul; NEXT_LOCALE=en", "accept-language": "tr" }))).toBe("en");
    expect(requestLocale(headers({ cookie: "NEXT_LOCALE=de", "accept-language": "tr" }))).toBe("tr");
    expect(requestLocale(headers({}))).toBe("en");
  });
});

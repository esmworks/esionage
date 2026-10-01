import { describe, expect, it } from "vitest";
import { anyWordTerms, anyWordTsQuery } from "./search-words";

describe("any-word search terms", () => {
  it("keeps the words worth searching for, long ones cut to a prefix", () => {
    expect(anyWordTerms("Kart ekstreleri ne durumda?")).toEqual(["Kart", "ekstr", "durum"]);
    expect(anyWordTerms("Which automobile needs tyres, and who sells them?")).toEqual(["autom", "needs", "tyres", "sells"]);
    expect(anyWordTsQuery(anyWordTerms("Garanti Ekim taksit"))).toBe("Garan:* | Ekim:* | taksit:*");
  });

  it("drops stopwords whatever their case, Turkish ones included", () => {
    expect(anyWordTerms("NEDİR bu NASIL için WHAT")).toEqual([]);
    expect(anyWordTerms("Hangi kart?")).toEqual(["kart"]);
  });

  it("lets nothing but letters and digits through, each word once", () => {
    expect(anyWordTerms("a'b & c | d:* !(x) '); drop--")).toEqual(["drop"]);
    expect(anyWordTerms("2026 ödeme Ödeme ÖDEME")).toEqual(["2026", "ödeme"]);
    expect(anyWordTerms("")).toEqual([]);
  });
});

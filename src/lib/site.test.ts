import { describe, expect, it } from "vitest";
import { isSiteKey, pageIdFromSegment, pageSegment, publishedHref, siteSlugProblem, slugify } from "./site";

const ID = "3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b";

describe("siteSlugProblem", () => {
  it("accepts lowercase words joined by single hyphens", () => {
    expect(siteSlugProblem("acme")).toBeNull();
    expect(siteSlugProblem("acme-docs-2")).toBeNull();
    expect(siteSlugProblem("a".repeat(40))).toBeNull();
  });

  it("names what is wrong", () => {
    expect(siteSlugProblem("ab")).toBe("tooShort");
    expect(siteSlugProblem("a".repeat(41))).toBe("tooLong");
    expect(siteSlugProblem("Acme")).toBe("invalid");
    expect(siteSlugProblem("-acme")).toBe("invalid");
    expect(siteSlugProblem("acme-")).toBe("invalid");
    expect(siteSlugProblem("ac--me")).toBe("invalid");
    expect(siteSlugProblem("acme docs")).toBe("invalid");
    expect(siteSlugProblem("açme")).toBe("invalid");
  });

  it("keeps back names that would pass for the app", () => {
    for (const slug of ["api", "admin", "sign-in", "settings", "leafdesk", "www"]) expect(siteSlugProblem(slug)).toBe("reserved");
  });
});

describe("isSiteKey", () => {
  it("tells slugs from publication tokens", () => {
    expect(isSiteKey("acme")).toBe(true);
    // Tokens are 32 random bytes in base64url: 43 characters, longer than any slug.
    expect(isSiteKey("k3j4h5g6f7d8s9a0q1w2e3r4t5y6u7i8o9p0lkjhgfd")).toBe(false);
    expect(isSiteKey("ABC_def")).toBe(false);
  });
});

describe("slugify", () => {
  it("turns titles into address words", () => {
    expect(slugify("Getting Started")).toBe("getting-started");
    expect(slugify("  Q3 plan: what's next?  ")).toBe("q3-plan-whats-next");
    expect(slugify("Ayşe'nin Çalışma Notları")).toBe("aysenin-calisma-notlari");
    expect(slugify("IĞDIR ılık")).toBe("igdir-ilik");
    expect(slugify("🚀")).toBe("");
  });

  it("cuts long titles without a trailing hyphen", () => {
    const out = slugify("word ".repeat(30), 12);
    expect(out.length).toBeLessThanOrEqual(12);
    expect(out.endsWith("-")).toBe(false);
  });
});

describe("page segments", () => {
  it("puts the title before the id and reads the id back", () => {
    expect(pageSegment(ID, "Road map")).toBe(`road-map-${ID}`);
    expect(pageSegment(ID, "")).toBe(ID);
    expect(pageIdFromSegment(`road-map-${ID}`)).toBe(ID);
    expect(pageIdFromSegment(`old-title-${ID}`)).toBe(ID);
    expect(pageIdFromSegment(ID.toUpperCase())).toBe(ID);
  });

  it("takes bare ids and refuses anything else", () => {
    expect(pageIdFromSegment("abc_123")).toBe("abc_123");
    expect(pageIdFromSegment("../etc")).toBeNull();
    expect(pageIdFromSegment("%E0%A4%A")).toBeNull();
    expect(pageIdFromSegment("x".repeat(65))).toBeNull();
  });
});

describe("publishedHref", () => {
  it("links publication pages by id and site pages by title and id", () => {
    const publication = { base: "/s/token", homeId: "root", site: false };
    expect(publishedHref(publication, "root", "Home")).toBe("/s/token");
    expect(publishedHref(publication, ID, "Road map")).toBe(`/s/token/${ID}`);
    const site = { base: "/s/acme", homeId: "root", site: true };
    expect(publishedHref(site, "root", "Home")).toBe("/s/acme");
    expect(publishedHref(site, ID, "Road map")).toBe(`/s/acme/road-map-${ID}`);
  });
});

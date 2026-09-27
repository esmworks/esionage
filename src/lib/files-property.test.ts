import { describe, expect, it } from "vitest";
import type { PropertyOptions, PropertyType, ViewConfig } from "@/db/schema/app";
import { aggregateFunctions, aggregateValues, valueKind } from "./aggregate";
import { withFormulas } from "./derived";
import { asFiles, fileIdOf, fileIdsInProperties, firstImageFile, pdfFileId, pdfViewUrl } from "./files";
import { canDefault, checkAnswers, formDefaults, isAskable, isPublicAskable } from "./forms";
import { applyView, displayValue, filterOperators, isSortable, normalizeValue, PropertyValueError } from "./properties";
import { coverProperty, galleryCover, layoutConfigError } from "./views";

const A = "AbCdEfGhIjKlMnOpQrStUv_-";
const B = "ZyXwVuTsRqPoNmLkJiHgFe01";
const C = "0123456789abcdefghijklmn";

type P = { id: string; name: string; type: PropertyType; options: PropertyOptions };
const prop = (id: string, name: string, type: PropertyType, options: PropertyOptions = {}): P => ({ id, name, type, options });
const files = prop("f", "Attachments", "files");

const png = (id: string, name = "photo.png") => ({ url: `/api/files/${id}`, name, type: "image/png" });
const pdf = (id: string, name = "report.pdf") => ({ url: `/api/files/${id}`, name, type: "application/pdf" });

describe("file ids in values", () => {
  it("reads bare ids, file paths and absolute file URLs, nothing else", () => {
    expect(fileIdOf(A)).toBe(A);
    expect(fileIdOf(`/api/files/${A}`)).toBe(A);
    expect(fileIdOf(`https://app.example/api/files/${A}?download=1`)).toBe(A);
    expect(fileIdOf(`/api/files/${A}/../x`)).toBeNull();
    expect(fileIdOf(`https://evil.example/files/${A}`)).toBeNull();
    expect(fileIdOf("javascript:alert(1)")).toBeNull();
    expect(fileIdOf(42)).toBeNull();
  });

  it("keeps only well-formed entries of a stored value", () => {
    expect(asFiles([png(A), { url: "https://example.com/x.png", name: "x" }, "nope", null, { url: `/api/files/${B}` }])).toEqual([
      png(A),
      { url: `/api/files/${B}`, name: "file", type: "application/octet-stream" },
    ]);
    expect(asFiles("text")).toEqual([]);
  });

  it("finds file ids in files values only, like the reference trigger", () => {
    const properties = {
      f: [png(A), pdf(B)],
      notes: `see /api/files/${C}`,
      list: [{ text: `/api/files/${C}`, checked: false }],
      other: [{ url: `https://app.example/api/files/${C}` }],
    };
    expect(fileIdsInProperties(properties).sort()).toEqual([A, B].sort());
  });

  it("finds the first image for gallery covers", () => {
    expect(firstImageFile([pdf(A), png(B)])?.url).toBe(`/api/files/${B}`);
    expect(firstImageFile([pdf(A), { ...png(B), type: "image/svg+xml" }])).toBeNull();
  });

  it("recognizes uploaded PDFs by their path and name", () => {
    expect(pdfFileId(`/api/files/${A}`, "Report.PDF")).toBe(A);
    expect(pdfFileId(`/api/files/${A}`, "report.png")).toBeNull();
    expect(pdfFileId(`https://other.example/api/files/${A}`, "report.pdf")).toBeNull();
    expect(pdfFileId("https://example.com/report.pdf", "report.pdf")).toBeNull();
    expect(pdfViewUrl(A)).toBe(`/api/files/${A}?view=pdf`);
  });
});

describe("files property values", () => {
  it("normalizes paths, URLs and {url, name} objects, once each", () => {
    expect(normalizeValue(files, [`/api/files/${A}`, { url: `https://app.example/api/files/${B}`, name: "b.pdf" }, A])).toEqual([
      { url: `/api/files/${A}`, name: "file", type: "application/octet-stream" },
      { url: `/api/files/${B}`, name: "b.pdf", type: "application/octet-stream" },
    ]);
    expect(normalizeValue(files, [])).toBeNull();
    expect(normalizeValue(files, null)).toBeNull();
  });

  it("refuses anything that isn't an uploaded file", () => {
    for (const bad of ["https://example.com/cat.png", [{ url: "/etc/passwd" }], [42], { name: "x" }]) {
      expect(() => normalizeValue(files, bad)).toThrow(PropertyValueError);
    }
    try {
      normalizeValue(files, ["nope"]);
    } catch (error) {
      expect((error as PropertyValueError).code).toBe("invalidFile");
    }
    expect(() => normalizeValue(files, Array.from({ length: 101 }, (_, i) => `/api/files/${String(i).padStart(24, "a")}`))).toThrow(
      PropertyValueError,
    );
  });

  it("displays as {name, url}", () => {
    expect(displayValue(files, [png(A)])).toEqual([{ name: "photo.png", url: `/api/files/${A}` }]);
    expect(displayValue(files, [])).toBeNull();
  });

  it("filters on empty only, and sorts by how many files a row holds", () => {
    expect(filterOperators("files").map((o) => o.op)).toEqual(["is_empty", "is_not_empty"]);
    expect(isSortable("files")).toBe(true);
    const at = new Date("2026-09-27T12:00:00Z");
    const rows = [
      { id: "none", title: "none", properties: {}, createdAt: at, updatedAt: at },
      { id: "two", title: "two", properties: { f: [png(A), pdf(B)] }, createdAt: at, updatedAt: at },
      { id: "one", title: "one", properties: { f: [png(C)] }, createdAt: at, updatedAt: at },
    ];
    const ids = (config: Parameters<typeof applyView>[1]) => applyView(rows, config, [files]).map((r) => r.id);
    expect(ids({ sorts: [{ propertyId: "f", direction: "asc" }] })).toEqual(["one", "two", "none"]);
    expect(ids({ sorts: [{ propertyId: "f", direction: "desc" }] })[0]).toBe("two");
    expect(ids({ filters: [{ propertyId: "f", op: "is_empty" }] })).toEqual(["none"]);
    expect(ids({ filters: [{ propertyId: "f", op: "is_not_empty" }] })).toEqual(["two", "one"]);
  });
});

describe("files in formulas and rollups", () => {
  it("reads as the list of file names", () => {
    const props = [files, prop("n", "Count", "formula", { formula: { expression: 'length(prop("Attachments"))' } })];
    const names = prop("j", "Names", "formula", { formula: { expression: 'join(prop("Attachments"), ", ")' } });
    const [out] = withFormulas([...props, names], [
      { id: "r", title: "r", properties: { f: [png(A), pdf(B)] } as Record<string, unknown>, createdAt: new Date(), updatedAt: new Date() },
    ], { now: new Date(), people: [], relations: {} });
    expect(out.properties.n).toBe(2);
    expect(out.properties.j).toBe("photo.png, report.pdf");
  });

  it("aggregates like other lists: counts, not sums", () => {
    expect(valueKind("files")).toBe("files");
    const fns = aggregateFunctions("files");
    expect(fns).toContain("count_not_empty");
    expect(fns).not.toContain("sum");
    expect(aggregateValues([[png(A)], null, [png(A), pdf(B)]], "count_not_empty", { type: "files" })).toMatchObject({ value: 2 });
    expect(aggregateValues([[png(A)], [png(A), pdf(B)]], "count_unique", { type: "files" })).toMatchObject({ value: 2 });
  });
});

describe("files in forms", () => {
  it("can be asked, publicly too, but not given a value for every answer", () => {
    expect(isAskable("files")).toBe(true);
    expect(isPublicAskable("files")).toBe(true);
    expect(canDefault("files")).toBe(false);
    expect(canDefault("text")).toBe(true);
    const form = { questions: [], defaults: { f: [png(A)] } };
    expect(formDefaults(form, [files])).toEqual({});
  });

  it("checks answers like row values", () => {
    const questions = [{ propertyId: "f", label: "", description: "", required: true, prop: files }];
    expect(checkAnswers(questions, {})).toMatchObject({ ok: false, errors: [{ propertyId: "f", code: "required" }] });
    expect(checkAnswers(questions, { f: ["https://example.com/x.png"] })).toMatchObject({
      ok: false,
      errors: [{ propertyId: "f", code: "invalidFile" }],
    });
    expect(checkAnswers(questions, { f: [{ url: `/api/files/${A}`, name: "a.png" }] })).toMatchObject({
      ok: true,
      properties: { f: [{ url: `/api/files/${A}`, name: "a.png" }] },
    });
  });
});

describe("gallery covers from a files property", () => {
  const props = [files, prop("t", "Tags", "multi_select")];
  it("resolves the cover property while it still is a files property", () => {
    const config: ViewConfig = { cover: { source: "property", propertyId: "f" } };
    expect(galleryCover(config)).toBe("property");
    expect(coverProperty(config, props)?.id).toBe("f");
    expect(coverProperty({ cover: { source: "property", propertyId: "t" } }, props)).toBeNull();
    expect(coverProperty({ cover: { source: "property", propertyId: "gone" } }, props)).toBeNull();
    expect(coverProperty({ cover: { source: "first_image" } }, props)).toBeNull();
    expect(galleryCover({})).toBe("first_image");
  });

  it("validates cover settings", () => {
    expect(layoutConfigError({ cover: { source: "property", propertyId: "f" } })).toBeNull();
    expect(layoutConfigError({ cover: { source: "property" } } as unknown as ViewConfig)).toMatch(/files property/);
    expect(layoutConfigError({ cover: { source: "cats" } } as unknown as ViewConfig)).toMatch(/Cover must be/);
  });
});

import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { collectFiles } from "./archive";

const ID = "0123456789abcdef0123456789abcdef";
const UUID = "4f2e8c1a-1b2c-4d3e-8f90-123456789abc";
const zip = (files: Record<string, string | Uint8Array>) =>
  zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, typeof v === "string" ? strToU8(v) : v])));

describe("collectFiles", () => {
  it("unpacks Notion's split export: an Export ZIP holding its parts", () => {
    const outer = zip({
      [`Export-${UUID}-Part-1.zip`]: zip({ [`Home ${ID}.md`]: "# Home", [`Home ${ID}/Child.md`]: "# Child" }),
      [`Export-${UUID}-Part-2.zip`]: zip({ [`Export-${UUID}-Part-2/Tasks ${ID}.csv`]: "Name\nA\n" }),
    });
    const { files, skipped } = collectFiles([{ path: `Export-${UUID}.zip`, data: outer }]);
    expect([...files.keys()].sort()).toEqual([`Home ${ID}.md`, `Home ${ID}/Child.md`, `Tasks ${ID}.csv`]);
    expect(skipped).toEqual([]);
  });

  it("leaves out ZIPs nested deeper and entries climbing out of the archive, and says so", () => {
    const data = zip({
      "ok.md": "fine",
      "../evil.md": "outside",
      "a/../../evil2.md": "outside too",
      "one.zip": zip({ "two.zip": zip({ "deep.md": "x" }), "inner.md": "y" }),
    });
    const { files, skipped } = collectFiles([{ path: "upload.zip", data }]);
    expect([...files.keys()].sort()).toEqual(["inner.md", "ok.md"]);
    expect(skipped).toEqual(
      expect.arrayContaining([
        { path: "../evil.md", reason: "unsafePath" },
        { path: "a/../../evil2.md", reason: "unsafePath" },
        { path: "two.zip", reason: "nestedZip" },
      ]),
    );
  });

  it("refuses more unpacked bytes than the limit before unpacking them", () => {
    // 301 MB of zeros packs into a few hundred KB; the directory's sizes give it away.
    const big = new Uint8Array(301 * 1024 * 1024);
    const data = zipSync({ "big.md": big }, { level: 1 });
    expect(() => collectFiles([{ path: "bomb.zip", data }])).toThrow(/too large/);
    // Packing 301 MB takes a few seconds, more while the other test files run alongside.
  }, 60_000);
});

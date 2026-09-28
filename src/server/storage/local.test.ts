import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { localDriver } from "./local";

async function text(stream: ReadableStream<Uint8Array> | null) {
  if (!stream) return null;
  return new Response(stream).text();
}

describe("localDriver", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "leafdesk-local-driver-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("stores bytes under a key and reads them back", async () => {
    const driver = localDriver(root);
    await driver.put("ws-1/abc", Readable.from([Buffer.from("hello "), Buffer.from("world")]), { size: 11, contentType: "text/plain" });
    expect(await text(await driver.get("ws-1/abc"))).toBe("hello world");
    expect((await stat(join(root, "ws-1", "abc"))).size).toBe(11);
  });

  it("reads an inclusive byte range", async () => {
    const driver = localDriver(root);
    await driver.put("ws-1/abc", Readable.from([Buffer.from("0123456789")]), { size: 10, contentType: "text/plain" });
    expect(await text(await driver.get("ws-1/abc", { start: 2, end: 5 }))).toBe("2345");
  });

  it("returns null for a missing key and deletes idempotently", async () => {
    const driver = localDriver(root);
    expect(await driver.get("ws-1/missing")).toBeNull();
    await driver.put("ws-1/abc", Readable.from([Buffer.from("x")]), { size: 1, contentType: "text/plain" });
    await driver.delete("ws-1/abc");
    await driver.delete("ws-1/abc");
    expect(await driver.get("ws-1/abc")).toBeNull();
  });

  it("replaces what was stored under the key", async () => {
    const driver = localDriver(root);
    await driver.put("ws-1/abc", Readable.from([Buffer.from("old")]), { size: 3, contentType: "text/plain" });
    await driver.put("ws-1/abc", Readable.from([Buffer.from("new!")]), { size: 4, contentType: "text/plain" });
    expect(await text(await driver.get("ws-1/abc"))).toBe("new!");
  });

  it("refuses a body of the wrong size and leaves nothing behind", async () => {
    const driver = localDriver(root);
    await expect(driver.put("ws-1/abc", Readable.from([Buffer.from("short")]), { size: 99, contentType: "text/plain" })).rejects.toThrow();
    expect(await driver.get("ws-1/abc")).toBeNull();
    expect(await readdir(join(root, ".tmp"))).toEqual([]);
  });

  it("leaves nothing behind when the body fails part way", async () => {
    const driver = localDriver(root);
    const failing = new Readable({
      read() {
        this.push(Buffer.from("part"));
        this.destroy(new Error("client went away"));
      },
    });
    await expect(driver.put("ws-1/abc", failing, { size: 10, contentType: "text/plain" })).rejects.toThrow("client went away");
    expect(await driver.get("ws-1/abc")).toBeNull();
    expect(await readdir(join(root, ".tmp"))).toEqual([]);
  });

  it("refuses keys that could leave its directory", async () => {
    const driver = localDriver(root);
    for (const key of ["../x", "/etc/passwd", "ws/../../x", "ws/./x", "", "a//b", "a/b/"]) {
      await expect(driver.get(key)).rejects.toThrow(/Bad storage key/);
      await expect(driver.delete(key)).rejects.toThrow(/Bad storage key/);
    }
  });
});

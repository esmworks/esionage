import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { driverFromEnv } from "./index";
import { s3Driver } from "./s3";

/**
 * A stand-in for an S3 endpoint: keeps objects in memory and records what the driver sent. It
 * doesn't check signatures (that is aws4fetch's job); it checks the requests have one, and the
 * addressing, lengths and ranges.
 */
type Seen = { method: string; url: string; headers: IncomingMessage["headers"]; body: Buffer };

let server: Server;
let endpoint: string;
const objects = new Map<string, Buffer>();
const seen: Seen[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      seen.push({ method: req.method!, url: req.url!, headers: req.headers, body });
      const key = req.url!;
      if (!String(req.headers.authorization ?? "").startsWith("AWS4-HMAC-SHA256 ") || key.startsWith("/denied/")) {
        res.writeHead(403).end("unsigned");
        return;
      }
      if (req.method === "PUT") {
        if (req.headers["transfer-encoding"] === "chunked") {
          res.writeHead(501).end("chunked uploads not supported");
          return;
        }
        objects.set(key, body);
        res.writeHead(200).end();
      } else if (req.method === "GET") {
        const object = objects.get(key);
        if (!object) {
          res.writeHead(404).end("<Error><Code>NoSuchKey</Code></Error>");
          return;
        }
        const range = /^bytes=(\d+)-(\d+)$/.exec(String(req.headers.range ?? ""));
        if (range) res.writeHead(206).end(object.subarray(Number(range[1]), Number(range[2]) + 1));
        else res.writeHead(200).end(object);
      } else if (req.method === "DELETE") {
        objects.delete(key);
        res.writeHead(204).end();
      } else {
        res.writeHead(405).end();
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  objects.clear();
  seen.length = 0;
});

const text = (stream: ReadableStream<Uint8Array> | null) => (stream ? new Response(stream).text() : null);

describe("s3Driver", () => {
  const driver = () =>
    s3Driver({ bucket: "uploads", endpoint, region: "us-east-1", accessKeyId: "key", secretAccessKey: "secret", forcePathStyle: true, prefix: "leafdesk/" });

  it("uploads a stream with its length, signed, by path under the prefix", async () => {
    await driver().put("ws-1/abc", Readable.from([Buffer.from("hello "), Buffer.from("world")]), { size: 11, contentType: "text/plain" });
    const put = seen.find((s) => s.method === "PUT")!;
    expect(put.url).toBe("/uploads/leafdesk/ws-1/abc");
    expect(put.headers["content-length"]).toBe("11");
    expect(put.headers["content-type"]).toBe("text/plain");
    expect(put.headers["x-amz-content-sha256"]).toBe("UNSIGNED-PAYLOAD");
    expect(put.body.toString()).toBe("hello world");
  });

  it("reads objects and byte ranges back, and null for missing ones", async () => {
    const d = driver();
    await d.put("ws-1/abc", Readable.from([Buffer.from("0123456789")]), { size: 10, contentType: "text/plain" });
    expect(await text(await d.get("ws-1/abc"))).toBe("0123456789");
    expect(await text(await d.get("ws-1/abc", { start: 3, end: 6 }))).toBe("3456");
    expect(seen.at(-1)!.headers.range).toBe("bytes=3-6");
    expect(await d.get("ws-1/missing")).toBeNull();
  });

  it("deletes objects, missing ones included", async () => {
    const d = driver();
    await d.put("ws-1/abc", Readable.from([Buffer.from("x")]), { size: 1, contentType: "text/plain" });
    await d.delete("ws-1/abc");
    await d.delete("ws-1/abc");
    expect(objects.size).toBe(0);
  });

  it("reports a refused upload, and refuses bad keys before sending", async () => {
    const denied = s3Driver({ bucket: "denied", endpoint, region: "us-east-1", accessKeyId: "key", secretAccessKey: "secret", forcePathStyle: true });
    await expect(denied.put("ws-1/abc", Readable.from([Buffer.from("x")]), { size: 1, contentType: "text/plain" })).rejects.toThrow(/403/);
    seen.length = 0;
    await expect(driver().put("../x", Readable.from([Buffer.from("x")]), { size: 1, contentType: "text/plain" })).rejects.toThrow(/Bad storage key/);
    expect(seen).toEqual([]);
  });
});

describe("driverFromEnv", () => {
  it("uses a local directory unless a bucket is set", () => {
    expect(driverFromEnv({}).kind).toBe("local");
    expect(driverFromEnv({ S3_BUCKET: "b", S3_ACCESS_KEY_ID: "k", S3_SECRET_ACCESS_KEY: "s" }).kind).toBe("s3");
  });

  it("names what an S3 setup is missing", () => {
    expect(() => driverFromEnv({ STORAGE_DRIVER: "s3", S3_BUCKET: "b" })).toThrow(/S3_ACCESS_KEY_ID/);
    expect(() => driverFromEnv({ STORAGE_DRIVER: "ftp" })).toThrow(/STORAGE_DRIVER/);
  });
});

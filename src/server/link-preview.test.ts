import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkTarget, fetchLinkPreview, LinkPreviewError, PREVIEW_MAX_BYTES } from "./link-preview";
import { isBlockedAddress } from "./ssrf";

const resolvesTo = (...addresses: string[]) => async () => addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));

async function code(promise: Promise<unknown>) {
  try {
    await promise;
    return "ok";
  } catch (error) {
    return error instanceof LinkPreviewError ? error.code : String(error);
  }
}

describe("checkTarget", () => {
  it("allows a public host on the web ports", async () => {
    await expect(checkTarget(new URL("https://example.com/a"), { lookup: resolvesTo("93.184.216.34") })).resolves.toEqual({
      address: "93.184.216.34",
      family: 4,
    });
    expect(await code(checkTarget(new URL("http://example.com:8080/"), { lookup: resolvesTo("93.184.216.34") }))).toBe("ok");
  });

  it("refuses private, loopback and metadata addresses, literal or resolved", async () => {
    const lookup = resolvesTo("93.184.216.34");
    for (const url of ["http://127.0.0.1/", "http://[::1]/", "http://169.254.169.254/latest/meta-data", "http://10.0.0.5/", "http://[fd00::1]/", "http://[::ffff:127.0.0.1]/"]) {
      expect(await code(checkTarget(new URL(url), { lookup })), url).toBe("blocked");
    }
    expect(await code(checkTarget(new URL("https://intranet.example.com/"), { lookup: resolvesTo("192.168.0.10") }))).toBe("blocked");
    // One private answer among public ones is enough to refuse.
    expect(await code(checkTarget(new URL("https://mixed.example.com/"), { lookup: resolvesTo("93.184.216.34", "127.0.0.1") }))).toBe("blocked");
  });

  it("refuses local host names without asking DNS", async () => {
    const lookup = resolvesTo("93.184.216.34");
    for (const url of ["http://localhost/", "http://localhost./", "http://db/", "http://printer.local/", "http://app.localhost/", "http://svc.internal/"]) {
      expect(await code(checkTarget(new URL(url), { lookup })), url).toBe("blocked");
    }
  });

  it("refuses other ports, schemes and credentials", async () => {
    const lookup = resolvesTo("93.184.216.34");
    expect(await code(checkTarget(new URL("http://example.com:22/"), { lookup }))).toBe("blocked");
    expect(await code(checkTarget(new URL("http://example.com:6379/"), { lookup }))).toBe("blocked");
    expect(await code(checkTarget(new URL("ftp://example.com/"), { lookup }))).toBe("invalidUrl");
    expect(await code(checkTarget(new URL("http://user:pw@example.com/"), { lookup }))).toBe("invalidUrl");
  });

  it("reports hosts that don't resolve", async () => {
    const failing = async () => {
      throw new Error("ENOTFOUND");
    };
    expect(await code(checkTarget(new URL("https://nowhere.example/"), { lookup: failing }))).toBe("unreachable");
  });
});

describe("fetchLinkPreview against a local server", () => {
  let server: http.Server;
  let port = 0;
  const hits: string[] = [];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      hits.push(req.url ?? "");
      const url = new URL(req.url ?? "/", "http://site.test");
      if (url.pathname === "/page") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(`<html><head><title>Plain &amp; simple</title><meta property="og:description" content="A page"><link rel="icon" href="/i.png"></head><body>x</body></html>`);
      } else if (url.pathname === "/latin1") {
        res.writeHead(200, { "content-type": "text/html; charset=iso-8859-1" });
        res.end(Buffer.from("<html><head><title>Caf\xe9</title></head></html>", "latin1"));
      } else if (url.pathname.startsWith("/hop/")) {
        const n = Number(url.pathname.slice(5));
        res.writeHead(302, { location: n > 0 ? `/hop/${n - 1}` : "/page" });
        res.end();
      } else if (url.pathname === "/to-internal") {
        res.writeHead(301, { location: "http://internal.test/admin" });
        res.end();
      } else if (url.pathname === "/huge") {
        // A head that never ends: reading must stop at the size limit, not at the end.
        res.writeHead(200, { "content-type": "text/html" });
        res.write("<html><head><title>Huge</title>");
        const chunk = `<meta name="x" content="${"a".repeat(64 * 1024)}">`;
        let sent = 0;
        const pump = () => {
          while (sent < PREVIEW_MAX_BYTES * 4) {
            sent += chunk.length;
            if (!res.write(chunk)) return void res.once("drain", pump);
          }
          res.end("</head></html>");
        };
        pump();
      } else if (url.pathname === "/slow") {
        res.writeHead(200, { "content-type": "text/html" });
        res.write("<html><head>");
        // Never finishes.
      } else if (url.pathname === "/image") {
        res.writeHead(200, { "content-type": "image/png" });
        res.end(Buffer.alloc(10));
      } else {
        res.writeHead(404, { "content-type": "text/html" });
        res.end("<title>Not found</title>");
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  /** site.test is the local server (allowed for the test); internal.test is a private address. */
  const guard = () => ({
    lookup: async (host: string) => [{ address: host === "site.test" ? "127.0.0.1" : "10.0.0.8", family: 4 }],
    isBlocked: (ip: string) => ip !== "127.0.0.1" && isBlockedAddress(ip),
    ports: new Set([String(port)]),
  });
  const at = (path: string) => `http://site.test:${port}${path}`;

  it("reads the details of a page", async () => {
    const preview = await fetchLinkPreview(at("/page"), guard());
    expect(preview).toMatchObject({ url: at("/page"), title: "Plain & simple", description: "A page", favicon: at("/i.png") });
  });

  it("decodes the charset the server declares", async () => {
    expect((await fetchLinkPreview(at("/latin1"), guard())).title).toBe("Café");
  });

  it("follows up to three redirects, each checked, and keeps the pasted URL", async () => {
    const preview = await fetchLinkPreview(at("/hop/2"), guard());
    expect(preview.url).toBe(at("/hop/2"));
    expect(preview.title).toBe("Plain & simple");
    expect(await code(fetchLinkPreview(at("/hop/3"), guard()))).toBe("tooManyRedirects");
  });

  it("refuses a redirect to a private address", async () => {
    hits.length = 0;
    expect(await code(fetchLinkPreview(at("/to-internal"), guard()))).toBe("blocked");
    expect(hits).toEqual(["/to-internal"]);
  });

  it("stops reading at the size limit", async () => {
    const preview = await fetchLinkPreview(at("/huge"), guard());
    expect(preview.title).toBe("Huge");
  });

  it("gives up after the timeout", async () => {
    const started = Date.now();
    expect(await code(fetchLinkPreview(at("/slow"), guard()))).toBe("timeout");
    expect(Date.now() - started).toBeLessThan(7000);
  }, 10_000);

  it("keeps only the URL for something that isn't a page", async () => {
    const preview = await fetchLinkPreview(at("/image"), guard());
    expect(preview.title).toBe("");
    expect(preview.favicon).toBe(at("/favicon.ico"));
  });

  it("reports error pages", async () => {
    expect(await code(fetchLinkPreview(at("/missing"), guard()))).toBe("httpError");
  });

  it("with the default guard, refuses the local server", async () => {
    expect(await code(fetchLinkPreview(`http://127.0.0.1:${port}/page`))).toBe("blocked");
  });
});

import { describe, expect, it } from "vitest";
import { clientIpFrom, trustedProxyCount } from "./client-ip";

describe("clientIpFrom", () => {
  it("takes the address the trusted proxy saw, not what the visitor wrote", () => {
    // Visitor sent a made-up header; the proxy appended the real address.
    expect(clientIpFrom("6.6.6.6, 203.0.113.7", "10.0.0.2", 1)).toBe("203.0.113.7");
    expect(clientIpFrom("203.0.113.7", "10.0.0.2", 1)).toBe("203.0.113.7");
    expect(clientIpFrom(["6.6.6.6", "203.0.113.7, 10.0.0.9"], "10.0.0.2", 2)).toBe("203.0.113.7");
  });

  it("uses the socket without a proxy, whatever the header says", () => {
    expect(clientIpFrom("6.6.6.6", "203.0.113.7", 0)).toBe("203.0.113.7");
    expect(clientIpFrom(undefined, "203.0.113.7", 0)).toBe("203.0.113.7");
  });

  it("falls back to the left-most address when there are fewer hops than proxies", () => {
    expect(clientIpFrom(undefined, "203.0.113.7", 1)).toBe("203.0.113.7");
    expect(clientIpFrom("", undefined, 1)).toBe("unknown");
  });
});

describe("trustedProxyCount", () => {
  it("defaults to one proxy and ignores nonsense", () => {
    expect(trustedProxyCount(undefined)).toBe(1);
    expect(trustedProxyCount("")).toBe(1);
    expect(trustedProxyCount("0")).toBe(0);
    expect(trustedProxyCount(" 2 ")).toBe(2);
    expect(trustedProxyCount("-1")).toBe(1);
    expect(trustedProxyCount("abc")).toBe(1);
  });
});

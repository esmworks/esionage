import { describe, expect, it } from "vitest";
import { parseUserAgent } from "./user-agent";

describe("parseUserAgent", () => {
  it("names common desktop browsers and systems", () => {
    expect(
      parseUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
      ),
    ).toEqual({ browser: "Chrome", os: "macOS", device: "desktop" });
    expect(
      parseUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0",
      ),
    ).toEqual({ browser: "Edge", os: "Windows", device: "desktop" });
    expect(parseUserAgent("Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0")).toEqual({
      browser: "Firefox",
      os: "Linux",
      device: "desktop",
    });
    expect(
      parseUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
      ),
    ).toEqual({ browser: "Safari", os: "macOS", device: "desktop" });
  });

  it("tells phones and tablets apart", () => {
    expect(
      parseUserAgent(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
      ),
    ).toEqual({ browser: "Safari", os: "iOS", device: "mobile" });
    expect(
      parseUserAgent(
        "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0 Mobile/15E148 Safari/604.1",
      ),
    ).toEqual({ browser: "Chrome", os: "iPadOS", device: "tablet" });
    expect(
      parseUserAgent(
        "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
      ),
    ).toEqual({ browser: "Chrome", os: "Android", device: "mobile" });
    expect(
      parseUserAgent(
        "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Safari/537.36",
      ),
    ).toEqual({ browser: "Samsung Internet", os: "Android", device: "tablet" });
  });

  it("says unknown rather than guessing", () => {
    expect(parseUserAgent("node")).toEqual({ browser: null, os: null, device: "desktop" });
    expect(parseUserAgent(null)).toEqual({ browser: null, os: null, device: "desktop" });
    expect(parseUserAgent("curl/8.7.1")).toEqual({ browser: null, os: null, device: "desktop" });
  });
});

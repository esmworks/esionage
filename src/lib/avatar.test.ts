import { describe, expect, it } from "vitest";
import { avatarName, avatarSrc, avatarStorageKey, avatarUrl, parseAvatarParts, parseAvatarUrl, sniffImage } from "./avatar";

const bytes = (...values: number[]) => new Uint8Array([...values, ...new Array(16).fill(0)]);
const RANDOM = "0123456789abcdef0123456789abcdef";

describe("sniffImage", () => {
  it("recognizes PNG, JPEG, WebP and GIF by their first bytes", () => {
    expect(sniffImage(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe("png");
    expect(sniffImage(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("jpeg");
    expect(sniffImage(bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50))).toBe("webp");
    expect(sniffImage(bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61))).toBe("gif");
  });

  it("refuses SVG, HTML and anything else, whatever it claims to be", () => {
    expect(sniffImage(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'))).toBeNull();
    expect(sniffImage(new TextEncoder().encode("<!doctype html>"))).toBeNull();
    // RIFF but not WebP (a WAV file).
    expect(sniffImage(bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45))).toBeNull();
    expect(sniffImage(new Uint8Array())).toBeNull();
  });
});

describe("avatar URLs", () => {
  it("round-trips our own URLs and maps them to a storage key", () => {
    const name = avatarName(RANDOM, "webp");
    const url = avatarUrl("user_1", name);
    expect(url).toBe(`/api/avatars/user_1/${RANDOM}-webp`);
    expect(parseAvatarUrl(url)).toEqual({ userId: "user_1", name, format: "webp" });
    expect(avatarStorageKey("user_1", name)).toBe(`avatars/user_1/${RANDOM}-webp`);
  });

  it("refuses paths that could reach other storage keys", () => {
    expect(parseAvatarUrl(`/api/avatars/../${RANDOM}-png`)).toBeNull();
    expect(parseAvatarUrl(`/api/avatars/u/${RANDOM}-png/extra`)).toBeNull();
    expect(parseAvatarParts("u", `${RANDOM}-svg`)).toBeNull();
    expect(parseAvatarParts("u", "short-png")).toBeNull();
    expect(parseAvatarParts("u/x", `${RANDOM}-png`)).toBeNull();
    expect(parseAvatarUrl("https://example.com/a.png")).toBeNull();
  });
});

describe("avatarSrc", () => {
  it("shows our own avatars and https pictures from providers", () => {
    expect(avatarSrc(avatarUrl("u", avatarName(RANDOM, "png")))).toBe(`/api/avatars/u/${RANDOM}-png`);
    expect(avatarSrc("https://avatars.githubusercontent.com/u/1?v=4")).toBe("https://avatars.githubusercontent.com/u/1?v=4");
  });

  it("shows nothing for other schemes, relative paths and junk", () => {
    expect(avatarSrc("http://tracker.example.com/pixel.gif")).toBeNull();
    expect(avatarSrc("javascript:alert(1)")).toBeNull();
    expect(avatarSrc("data:image/svg+xml,<svg/>")).toBeNull();
    expect(avatarSrc("/api/files/abc")).toBeNull();
    expect(avatarSrc("")).toBeNull();
    expect(avatarSrc(null)).toBeNull();
  });
});

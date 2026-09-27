/**
 * A readable name for the browser and system behind a session, from its User-Agent header, for
 * the account page's list of sessions. Only tells apart what people recognize (Chrome on macOS,
 * Safari on iPhone); anything else is "unknown" rather than a guess.
 */

export type DeviceKind = "desktop" | "mobile" | "tablet";

export type UserAgentInfo = {
  browser: string | null;
  os: string | null;
  device: DeviceKind;
};

// Order matters: Edge, Opera and Samsung Internet also say "Chrome", and Chrome also says "Safari".
const BROWSERS: [RegExp, string][] = [
  [/\bEdg(?:e|A|iOS)?\//, "Edge"],
  [/\b(?:OPR|Opera)\//, "Opera"],
  [/\bSamsungBrowser\//, "Samsung Internet"],
  [/\bVivaldi\//, "Vivaldi"],
  [/\bYaBrowser\//, "Yandex Browser"],
  [/\b(?:Firefox|FxiOS)\//, "Firefox"],
  [/\b(?:Chrome|CriOS|Chromium)\//, "Chrome"],
  [/\bVersion\/[\d.]+.*\bSafari\//, "Safari"],
  [/\bAppleWebKit\/.*\bMobile\//, "Safari"],
];

const SYSTEMS: [RegExp, string][] = [
  [/\biPhone\b|\biPod\b/, "iOS"],
  [/\biPad\b/, "iPadOS"],
  [/\bAndroid\b/, "Android"],
  [/\bCrOS\b/, "ChromeOS"],
  [/\bWindows\b/, "Windows"],
  [/\bMac OS X\b|\bMacintosh\b/, "macOS"],
  [/\bLinux\b/, "Linux"],
];

export function parseUserAgent(userAgent: string | null | undefined): UserAgentInfo {
  const ua = (userAgent ?? "").slice(0, 512);
  const browser = BROWSERS.find(([pattern]) => pattern.test(ua))?.[1] ?? null;
  const os = SYSTEMS.find(([pattern]) => pattern.test(ua))?.[1] ?? null;
  let device: DeviceKind = "desktop";
  if (/\biPad\b|\bTablet\b/.test(ua) || (/\bAndroid\b/.test(ua) && !/\bMobile\b/.test(ua))) device = "tablet";
  else if (/\bMobi|\biPhone\b|\biPod\b/.test(ua)) device = "mobile";
  return { browser, os, device };
}

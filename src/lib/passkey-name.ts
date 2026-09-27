/** A starting name for a new passkey, from the device it is made on; people can rename it. */
export function defaultPasskeyName(userAgent: string) {
  const devices: [RegExp, string][] = [
    [/iPhone/, "iPhone"],
    [/iPad/, "iPad"],
    [/Android/, "Android"],
    [/CrOS/, "Chromebook"],
    [/Macintosh|Mac OS X/, "Mac"],
    [/Windows/, "Windows"],
    [/Linux/, "Linux"],
  ];
  return devices.find(([pattern]) => pattern.test(userAgent))?.[1] ?? "Passkey";
}

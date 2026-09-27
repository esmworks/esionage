/**
 * Profile pictures. An uploaded one is stored under `avatars/<user id>/<name>` and `user.image`
 * points at `/api/avatars/<user id>/<name>`; the name is random, so a new picture gets a new URL
 * and the old one can be cached for good. Accounts from GitHub or Google may instead carry the
 * provider's picture URL; those show as they are, but nobody can set an arbitrary URL.
 */

/** Largest upload accepted; the browser scales pictures down to AVATAR_SIZE before sending. */
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
/** Width and height (px) the browser crops and scales a picture to before uploading it. */
export const AVATAR_SIZE = 256;

export const AVATAR_TYPES = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
} as const;
export type AvatarFormat = keyof typeof AVATAR_TYPES;

const AVATAR_PREFIX = "/api/avatars/";
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const NAME = /^([0-9a-f]{32})-(png|jpeg|webp|gif)$/;

/**
 * The format of an image from its first bytes (not its name or declared type). SVG is not an
 * option: it can carry scripts.
 */
export function sniffImage(bytes: Uint8Array): AvatarFormat | null {
  const at = (offset: number, ...values: number[]) => values.every((v, i) => bytes[offset + i] === v);
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "png";
  if (at(0, 0xff, 0xd8, 0xff)) return "jpeg";
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "webp";
  if (at(0, 0x47, 0x49, 0x46, 0x38) && (at(4, 0x37, 0x61) || at(4, 0x39, 0x61))) return "gif";
  return null;
}

export function avatarName(random: string, format: AvatarFormat) {
  return `${random}-${format}`;
}

export const avatarUrl = (userId: string, name: string) => `${AVATAR_PREFIX}${userId}/${name}`;
export const avatarStorageKey = (userId: string, name: string) => `avatars/${userId}/${name}`;

/** The parts of one of our avatar URLs, or null. */
export function parseAvatarUrl(url: string | null | undefined): { userId: string; name: string; format: AvatarFormat } | null {
  if (!url?.startsWith(AVATAR_PREFIX)) return null;
  const [userId, name, ...rest] = url.slice(AVATAR_PREFIX.length).split("/");
  if (rest.length || !userId || !name) return null;
  return parseAvatarParts(userId, name);
}

export function parseAvatarParts(userId: string, name: string) {
  const match = NAME.exec(name);
  if (!ID.test(userId) || !match) return null;
  return { userId, name, format: match[2] as AvatarFormat };
}

/**
 * What an `<img>` may show for `user.image`: our own avatar URLs and https pictures (a provider's).
 * Anything else, including plain http, shows the initial instead.
 */
export function avatarSrc(image: string | null | undefined): string | null {
  if (!image) return null;
  if (parseAvatarUrl(image)) return image;
  try {
    return new URL(image).protocol === "https:" ? image : null;
  } catch {
    return null;
  }
}

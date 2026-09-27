import { getTranslations } from "next-intl/server";
import { MAX_AVATAR_BYTES } from "@/lib/avatar";
import { auth } from "@/lib/auth";
import { env } from "@/lib/env";
import { AccountError, setAvatar } from "@/server/account";

/**
 * Uploads a new profile picture: `POST /api/account/avatar` with the image as the body (PNG, JPEG,
 * WebP or GIF, at most MAX_AVATAR_BYTES; the account page crops and scales it first) and
 * `X-Avatar-Upload: 1`. Answers 201 with `{ image }`, the new `user.image`.
 *
 * The custom header is the CSRF protection, as for /api/files: a cross-site form can't send it and
 * a cross-site fetch with it needs a preflight this route doesn't answer. A foreign Origin is
 * refused too.
 */
export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers }).catch(() => null);
  if (!session) return Response.json({ error: "Sign in first" }, { status: 401 });
  const origin = request.headers.get("origin");
  const hosts = [new URL(env.appUrl).host, request.headers.get("x-forwarded-host"), request.headers.get("host")];
  if (request.headers.get("x-avatar-upload") !== "1" || (origin && !hosts.includes(URL.parse(origin)?.host ?? ""))) {
    return Response.json({ error: "Cross-site uploads aren't allowed" }, { status: 403 });
  }
  const t = await getTranslations("account.errors");
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_AVATAR_BYTES) return Response.json({ error: t("avatarTooLarge"), code: "avatarTooLarge" }, { status: 413 });

  // Read at most one byte past the limit: enough to know it's too large.
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (request.body) {
    const reader = request.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_AVATAR_BYTES) {
        await reader.cancel();
        return Response.json({ error: t("avatarTooLarge"), code: "avatarTooLarge" }, { status: 413 });
      }
      chunks.push(value);
    }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const image = await setAvatar(session.user.id, bytes);
    return Response.json({ image }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!(error instanceof AccountError)) throw error;
    const status = error.code === "avatarTooLarge" ? 413 : error.code === "rateLimited" ? 429 : 400;
    return Response.json({ error: t(error.code), code: error.code }, { status });
  }
}

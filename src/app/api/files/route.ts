import { auth } from "@/lib/auth";
import { env } from "@/lib/env";
import { AccessError } from "@/server/access";
import { FileError, uploadFile } from "@/server/files";

/**
 * Uploads a file to a page: `POST /api/files?pageId=<id>` with the raw bytes as the body, the
 * file's type as Content-Type and its name, URI-encoded, in `X-File-Name`. Answers 201 with the
 * stored file (`url` is what the block keeps). The editor's BlockNote `uploadFile` calls this.
 *
 * The custom header doubles as CSRF protection: a cross-site form can't send it, and a cross-site
 * fetch with it needs a CORS preflight this route doesn't answer. A foreign Origin is refused too.
 */
export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return Response.json({ error: "Sign in to upload files" }, { status: 401 });

  const origin = request.headers.get("origin");
  const hosts = [new URL(env.appUrl).host, request.headers.get("x-forwarded-host"), request.headers.get("host")];
  if (origin && !hosts.includes(URL.parse(origin)?.host ?? "")) {
    return Response.json({ error: "Cross-site uploads aren't allowed" }, { status: 403 });
  }
  const rawName = request.headers.get("x-file-name");
  const pageId = new URL(request.url).searchParams.get("pageId");
  if (rawName === null || !pageId || !request.body) {
    return Response.json({ error: "Send the file as the body, with X-File-Name and ?pageId=" }, { status: 400 });
  }
  let name = rawName;
  try {
    name = decodeURIComponent(rawName);
  } catch {}
  const length = request.headers.get("content-length");

  try {
    const stored = await uploadFile(session.user.id, pageId, {
      name,
      contentType: request.headers.get("content-type"),
      body: request.body,
      declaredSize: length && /^\d+$/.test(length) ? Number(length) : null,
    });
    return Response.json(stored, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AccessError) return Response.json({ error: error.message }, { status: 404 });
    if (error instanceof FileError) {
      const status = error.code === "tooLarge" || error.code === "quotaExceeded" ? 413 : error.code === "notAllowed" ? 403 : 400;
      return Response.json({ error: error.message, code: error.code, limit: error.limit }, { status });
    }
    throw error;
  }
}

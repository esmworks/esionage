import { auth } from "@/lib/auth";
import { dispositionOf, isSafeInline, parseRange } from "@/lib/files";
import { fileForViewer } from "@/server/files";
import { getStorage } from "@/server/storage";

/**
 * Serves an uploaded file to whoever may read it (see server/files.ts `fileForViewer`): people who
 * can view a page showing it, and visitors of a published page showing it. Anyone else gets the
 * same 404 as for a file that doesn't exist.
 *
 * Only raster images, video, audio and PDF are shown in the browser; everything else (SVG and
 * HTML included) is a download, never sniffed into something else, and sandboxed should a browser
 * render it anyway. Single byte ranges are served, so video and audio can seek.
 */
const BASE_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Cross-Origin-Resource-Policy": "same-origin",
};

function notFound() {
  return new Response("Not found", { status: 404, headers: { ...BASE_HEADERS, "Cache-Control": "no-store", "Content-Type": "text/plain" } });
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth.api.getSession({ headers: request.headers }).catch(() => null);
  const found = await fileForViewer(session?.user.id ?? null, id);
  if (!found) return notFound();

  const headers: Record<string, string> = {
    ...BASE_HEADERS,
    "Content-Type": found.contentType,
    "Content-Disposition": dispositionOf(found.contentType, found.name),
    // Access can be taken away, so only the viewer's own browser keeps it, and not for long.
    "Cache-Control": "private, max-age=300",
    ETag: `"${found.id}"`,
    "Accept-Ranges": "bytes",
  };
  // Browsers' PDF viewers don't run in a sandbox; every other type can do without scripts entirely.
  if (found.contentType !== "application/pdf") {
    headers["Content-Security-Policy"] = isSafeInline(found.contentType)
      ? "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox"
      : "default-src 'none'; sandbox";
  }

  // The bytes behind an id never change.
  if (request.headers.get("if-none-match") === headers.ETag) return new Response(null, { status: 304, headers });

  const range = parseRange(request.headers.get("range"), found.size);
  if (range === "unsatisfiable") {
    return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${found.size}` } });
  }
  const body = await getStorage().get(found.storageKey, range ?? undefined);
  if (!body) return notFound();
  if (range) {
    headers["Content-Range"] = `bytes ${range.start}-${range.end}/${found.size}`;
    headers["Content-Length"] = String(range.end - range.start + 1);
    return new Response(body, { status: 206, headers });
  }
  headers["Content-Length"] = String(found.size);
  return new Response(body, { status: 200, headers });
}

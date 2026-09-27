import { unzipSync } from "fflate";
import { IMPORT_LIMITS, importFileKind, isIgnoredPath, normalizePath } from "@/lib/import/markdown";
import { ImportError } from "@/lib/import/result";

/**
 * The files of an upload by path: loose files as they came (a folder picked in the browser keeps
 * its relative paths), and ZIP files unpacked in place of themselves. Several ZIPs (Notion splits
 * large exports into parts) merge into one tree, and ZIPs inside a ZIP are unpacked once more.
 *
 * Unpacking is bounded before it starts: entry sizes come from the ZIP's directory and the
 * decompressor never writes past them, so a ZIP bomb can't take more memory than the limits.
 */

export type UploadedFile = { path: string; data: Uint8Array };

type Budget = { files: number; bytes: number };

function take(budget: Budget, bytes: number) {
  budget.files++;
  budget.bytes += bytes;
  if (budget.files > IMPORT_LIMITS.files) {
    throw new ImportError(`An import can hold at most ${IMPORT_LIMITS.files} files`, "tooManyFiles", { limit: IMPORT_LIMITS.files });
  }
  if (budget.bytes > IMPORT_LIMITS.unpackedBytes) {
    throw new ImportError("The unpacked files are too large to import", "tooLarge", { limit: IMPORT_LIMITS.unpackedBytes });
  }
}

function unzip(data: Uint8Array, budget: Budget, depth: number, out: Map<string, Uint8Array>, skipped: string[]) {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(data, {
      filter: (entry) => {
        const path = normalizePath(entry.name);
        if (entry.name.endsWith("/") || !path || isIgnoredPath(path)) return false;
        take(budget, entry.originalSize);
        return true;
      },
    });
  } catch (error) {
    if (error instanceof ImportError) throw error;
    throw new ImportError("The ZIP file can't be read", "badZip");
  }
  for (const [name, bytes] of Object.entries(entries)) {
    const path = normalizePath(name)!;
    if (importFileKind(path) === "zip") {
      if (depth < 1) unzip(bytes, budget, depth + 1, out, skipped);
      else skipped.push(path);
    } else out.set(path, bytes);
  }
}

/** The upload's files by normalized path, and nested ZIPs left packed. */
export function collectFiles(files: UploadedFile[]): { files: Map<string, Uint8Array>; skipped: string[] } {
  const out = new Map<string, Uint8Array>();
  const skipped: string[] = [];
  const budget: Budget = { files: 0, bytes: 0 };
  for (const file of files) {
    const path = normalizePath(file.path);
    if (!path || isIgnoredPath(path)) continue;
    if (importFileKind(path) === "zip") unzip(file.data, budget, 0, out, skipped);
    else {
      take(budget, file.data.byteLength);
      out.set(path, file.data);
    }
  }
  // "Export-1a2b…/" around a ZIP's files (Notion's, each part of a split export): not a page of its own.
  const unwrapped = new Map<string, Uint8Array>();
  for (const [path, bytes] of out) {
    const inner = path.replace(/^Export-[0-9a-f-]+\//i, "");
    if (inner && !unwrapped.has(inner)) unwrapped.set(inner, bytes);
  }
  return { files: unwrapped, skipped };
}

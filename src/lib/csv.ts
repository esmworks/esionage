/**
 * RFC 4180 CSV. Cells that a spreadsheet would run as a formula (=, +, -, @, tab, CR) get a
 * leading apostrophe, so a member named "=HYPERLINK(…)" can't run code in whoever opens the file.
 */
export function csvCell(value: string | number | Date | null | undefined): string {
  if (value === null || value === undefined) return "";
  let text = value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Rows to a CSV document with CRLF line ends and a BOM, so Excel reads UTF-8 names correctly. */
export function toCsv(rows: (string | number | Date | null | undefined)[][]): string {
  return "﻿" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

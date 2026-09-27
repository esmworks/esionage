import { fail } from "./types";

export type TokenKind = "number" | "string" | "name" | "op" | "punct" | "eof";
/** `value` is the operator, name or the string's content (escapes resolved); `start`/`end` index the source. */
export type Token = { kind: TokenKind; value: string; start: number; end: number };

// Longest first, so "<=" wins over "<".
const OPERATORS = ["==", "!=", "<=", ">=", "&&", "||", "+", "-", "*", "/", "%", "^", "<", ">", "!", "="];
/** Opening quote → closing quote. Typographic quotes come along when formulas are pasted from documents. */
const QUOTES: Record<string, string> = { '"': '"', "'": "'", "“": "”", "‘": "’" };
const ESCAPES: Record<string, string> = { n: "\n", t: "\t", r: "\r" };

/**
 * Splits an expression into tokens. Throws a FormulaFailure at the first character that can't
 * start a token; with `tolerant` it stops there instead and returns what it has read (used to
 * rewrite `prop("…")` references in text that is still being typed).
 */
export function tokenize(source: string, { tolerant = false }: { tolerant?: boolean } = {}): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = source.length;
  try {
    while (i < n) {
      const c = source[i];
      if (/\s/.test(c)) {
        i++;
        continue;
      }
      const start = i;
      if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(source[i + 1] ?? ""))) {
        const match = /^(\d*\.?\d+|\d+\.)([eE][+-]?\d+)?/.exec(source.slice(i))!;
        i += match[0].length;
        tokens.push({ kind: "number", value: match[0], start, end: i });
        continue;
      }
      if (/[A-Za-z_]/.test(c)) {
        const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(i))!;
        i += match[0].length;
        tokens.push({ kind: "name", value: match[0], start, end: i });
        continue;
      }
      const close = QUOTES[c];
      if (close) {
        let value = "";
        i++;
        for (;;) {
          if (i >= n) fail("unterminatedString", "A text in quotes is missing its closing quote", {}, { start, end: n });
          const ch = source[i];
          if (ch === close || (close !== c && ch === c)) {
            i++;
            break;
          }
          if (ch === "\\" && i + 1 < n) {
            const next = source[i + 1];
            value += ESCAPES[next] ?? next;
            i += 2;
            continue;
          }
          value += ch;
          i++;
        }
        tokens.push({ kind: "string", value, start, end: i });
        continue;
      }
      if (c === "(" || c === ")" || c === ",") {
        i++;
        tokens.push({ kind: "punct", value: c, start, end: i });
        continue;
      }
      const op = OPERATORS.find((o) => source.startsWith(o, i));
      if (op) {
        i += op.length;
        tokens.push({ kind: "op", value: op, start, end: i });
        continue;
      }
      fail("syntax", `Unexpected character "${c}"`, { token: c }, { start, end: start + 1 });
    }
  } catch (error) {
    if (!tolerant) throw error;
    return tokens;
  }
  tokens.push({ kind: "eof", value: "", start: n, end: n });
  return tokens;
}

/** A string as a double-quoted formula literal. */
export function quote(text: string) {
  return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
}

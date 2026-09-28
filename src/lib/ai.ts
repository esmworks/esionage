// Client-safe: shared by the AI server code (src/server/ai*) and the editor and database UI.

export const AI_ERROR_CODES = [
  /** The server has no AI provider, or the workspace turned AI off. */
  "disabled",
  /** The page or row doesn't exist or the person may not change it. */
  "noAccess",
  /** More text than one request may send (AI_MAX_INPUT_CHARS). */
  "tooLarge",
  "rateLimited",
  "timeout",
  /** Cancelled by the person (or their connection closed). */
  "aborted",
  /** The provider refused or failed (bad key, unknown model, outage). */
  "provider",
  /** The model answered with nothing usable. */
  "empty",
  /** The request itself is malformed (unknown action, missing text). */
  "invalid",
  /** A background value was being worked out when the server restarted. */
  "interrupted",
] as const;
export type AiErrorCode = (typeof AI_ERROR_CODES)[number];

export const isAiErrorCode = (code: unknown): code is AiErrorCode =>
  typeof code === "string" && (AI_ERROR_CODES as readonly string[]).includes(code);

/**
 * Writing actions in the editor. Actions on a selection rewrite it; "continue" writes on from the
 * cursor, "summarize" sums up the whole page, "custom" follows the person's own instruction (on
 * the selection, or writing new text without one).
 */
export const EDITOR_ACTIONS = ["improve", "shorten", "fix", "translate", "continue", "summarize", "custom"] as const;
export type EditorAction = (typeof EDITOR_ACTIONS)[number];

/** Actions that rewrite selected text (their result can replace it). */
export const SELECTION_ACTIONS: readonly EditorAction[] = ["improve", "shorten", "fix", "translate"];

/**
 * Target languages offered for translation (BCP 47). The prompt names them in English; the UI
 * names them in the reader's language with Intl.DisplayNames.
 */
export const AI_LANGUAGES = ["en", "tr", "de", "fr", "es", "it", "pt", "nl", "pl", "ru", "uk", "ar", "ja", "ko", "zh"] as const;
export type AiLanguage = (typeof AI_LANGUAGES)[number];

export const isAiLanguage = (value: unknown): value is AiLanguage =>
  typeof value === "string" && (AI_LANGUAGES as readonly string[]).includes(value);

/** A language code's English name, for prompts. */
export function languageName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

// ----------------------------------------------------------------------------------- autofill

/**
 * AI autofill of a text property (#42), stored in the property's options. Values are ordinary text
 * values, so filters, sorts, exports, the REST API and MCP treat them like any other text.
 * - `summary`: sums up the row's page content (and title).
 * - `translation`: translates one source (a property, the title or the page content) into `language`.
 * - `custom`: follows `prompt`, where `{Property name}` stands for that property's value of the row,
 *   `{title}` for the row's title; with `includeBody` the page content goes along too.
 * Values are worked out on request (a row's refresh, "update all"); with `auto` also after the row's
 * other values or content change.
 */
export type AiAutofillMode = "summary" | "translation" | "custom";
export const AI_AUTOFILL_MODES: readonly AiAutofillMode[] = ["summary", "translation", "custom"];

export type AiAutofillConfig = {
  mode: AiAutofillMode;
  /** translation: the target language (see AI_LANGUAGES). */
  language?: string;
  /** translation: a property id, "title" or "body". */
  source?: string;
  /** custom: the instruction, with `{Property}` placeholders. */
  prompt?: string;
  /** custom: send the row's page content along. */
  includeBody?: boolean;
  /** Work the value out again (debounced) when the row's other values or content change. */
  auto?: boolean;
};

export const AUTOFILL_TITLE = "title";
export const AUTOFILL_BODY = "body";
export const MAX_AUTOFILL_PROMPT = 2000;
/** Longest value an autofill writes; longer answers are cut. */
export const MAX_AUTOFILL_VALUE = 5000;
/** Rows one "update all" may queue. */
export const MAX_AUTOFILL_ROWS = 500;

/** The names in a prompt's `{…}` placeholders, in order, each once. */
export function promptPlaceholders(prompt: string): string[] {
  const names = [...prompt.matchAll(/\{([^{}\n]{1,100})\}/g)].map((m) => m[1].trim()).filter(Boolean);
  return [...new Set(names)];
}

export const AUTOFILL_ERROR_CODES = ["invalidMode", "unknownLanguage", "unknownSource", "promptRequired", "promptTooLong", "unknownPlaceholder"] as const;
export type AutofillErrorCode = (typeof AUTOFILL_ERROR_CODES)[number];
export type AutofillCheck = { ok: true; config: AiAutofillConfig } | { ok: false; code: AutofillErrorCode; params?: Record<string, string> };

/**
 * Checks autofill settings against the database's properties (`selfId`: the property being set up,
 * which can't be its own input) and returns them cleaned: only the fields the mode uses.
 */
export function checkAutofill(input: unknown, properties: { id: string; name: string }[], selfId?: string): AutofillCheck {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const mode = raw.mode as AiAutofillMode;
  if (!AI_AUTOFILL_MODES.includes(mode)) return { ok: false, code: "invalidMode" };
  const auto = raw.auto === true;
  const others = properties.filter((p) => p.id !== selfId);
  if (mode === "summary") return { ok: true, config: { mode, auto } };
  if (mode === "translation") {
    if (!isAiLanguage(raw.language)) return { ok: false, code: "unknownLanguage" };
    const source = typeof raw.source === "string" ? raw.source : AUTOFILL_TITLE;
    if (source !== AUTOFILL_TITLE && source !== AUTOFILL_BODY && !others.some((p) => p.id === source)) {
      return { ok: false, code: "unknownSource" };
    }
    return { ok: true, config: { mode, language: raw.language, source, auto } };
  }
  const prompt = typeof raw.prompt === "string" ? raw.prompt.trim() : "";
  if (!prompt) return { ok: false, code: "promptRequired" };
  if (prompt.length > MAX_AUTOFILL_PROMPT) return { ok: false, code: "promptTooLong", params: { max: String(MAX_AUTOFILL_PROMPT) } };
  const known = new Set([AUTOFILL_TITLE, ...others.map((p) => p.name.trim().toLowerCase())]);
  const unknown = promptPlaceholders(prompt).find((name) => !known.has(name.toLowerCase()));
  if (unknown) return { ok: false, code: "unknownPlaceholder", params: { name: unknown } };
  return { ok: true, config: { mode, prompt, includeBody: raw.includeBody === true, auto } };
}

/** Where a background value stands, per row and property; values without an entry are done. */
export type AiCellState = { status: "pending" } | { status: "error"; code: AiErrorCode };

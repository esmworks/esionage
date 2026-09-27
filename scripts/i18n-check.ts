/**
 * Checks the translations against English: missing and extra files and keys, empty texts, and
 * messages whose placeholders or plural/select syntax differ from the English ones.
 *
 *   pnpm i18n:check            every language
 *   pnpm i18n:check de fr      only these
 *
 * Exits with 1 when something is wrong. See CONTRIBUTING.md (Translations).
 */
import { fileURLToPath } from "node:url";
import { checkTranslations, formatIssues } from "../src/i18n/check";
import { DEFAULT_LOCALE, LOCALES } from "../src/i18n/config";

const dir = fileURLToPath(new URL("../src/i18n/messages", import.meta.url));
const only = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));
const unknown = only.filter((locale) => !(LOCALES as string[]).includes(locale));
if (unknown.length) {
  console.error(`Not a language in src/i18n/config.ts: ${unknown.join(", ")} (known: ${LOCALES.join(", ")})`);
  process.exit(1);
}

const issues = checkTranslations(dir, LOCALES, DEFAULT_LOCALE, only.length ? only : undefined);
const checked = (only.length ? only : LOCALES.filter((l) => l !== DEFAULT_LOCALE)).join(", ");
if (issues.length === 0) {
  console.log(`Translations are complete: ${checked} match ${DEFAULT_LOCALE}.`);
} else {
  console.log(formatIssues(issues));
  const locales = new Set(issues.map((issue) => issue.locale));
  console.log(`\n${issues.length} problem${issues.length === 1 ? "" : "s"} in ${[...locales].join(", ")}.`);
  process.exit(1);
}

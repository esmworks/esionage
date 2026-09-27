/**
 * Sends a test email with the SMTP settings from the environment (or .env):
 *
 *   pnpm mail:test you@example.com [--locale tr]
 *
 * In Docker: docker compose exec app tsx scripts/send-test-email.ts you@example.com
 */
import { isLocale, LOCALES } from "../src/i18n/config";
import { describeMailSetup, mailStatus, sendMail, testEmail } from "../src/server/mail";

// The mail module reads its settings on first use, so loading .env here is early enough.
try {
  process.loadEnvFile();
} catch {}

const args = process.argv.slice(2);
const localeIndex = args.indexOf("--locale");
const locale = localeIndex === -1 ? "en" : args.splice(localeIndex, 2)[1];
const [to] = args;

if (!to || !to.includes("@") || !isLocale(locale)) {
  console.error(`Usage: pnpm mail:test you@example.com [--locale ${LOCALES.join("|")}]`);
  process.exit(2);
}

console.log(describeMailSetup());
try {
  await sendMail({ to, ...testEmail(locale) });
  console.log(mailStatus() === "smtp" ? `Sent a test email to ${to}.` : "Printed the test email above.");
} catch (error) {
  console.error(`Could not send the test email: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}

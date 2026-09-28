import type { SMTPTransportOptions } from "nodemailer";

export type MailConfig = {
  transport: SMTPTransportOptions;
  from: string;
  /** Where mail goes, without credentials; safe to log. */
  description: string;
};

export class MailConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MailConfigError";
  }
}

// Fail fast instead of holding a request for nodemailer's default two-minute connect timeout.
const TIMEOUTS = { connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 30_000 };

function parseBoolean(name: string, value: string | undefined): boolean | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (["1", "true", "yes"].includes(normalized)) return true;
  if (["0", "false", "no"].includes(normalized)) return false;
  throw new MailConfigError(`${name} must be true or false`);
}

function parsePort(value: string | undefined): number | undefined {
  if (!value?.trim()) return undefined;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new MailConfigError("SMTP_PORT must be a port number");
  return port;
}

/**
 * SMTP settings from the environment: either SMTP_URL (smtp:// or smtps://, credentials in the
 * URL), or SMTP_HOST with optional SMTP_PORT, SMTP_SECURE, SMTP_USER and SMTP_PASSWORD. MAIL_FROM
 * is required with both. Returns null when SMTP is not configured at all.
 */
export function readMailConfig(vars: Record<string, string | undefined> = process.env): MailConfig | null {
  const url = vars.SMTP_URL?.trim();
  const host = vars.SMTP_HOST?.trim();
  if (!url && !host) return null;

  const from = vars.MAIL_FROM?.trim();
  if (!from) {
    throw new MailConfigError('MAIL_FROM is required when SMTP is configured, e.g. MAIL_FROM="Leafdesk <no-reply@example.com>"');
  }

  if (url) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new MailConfigError("SMTP_URL is not a valid URL");
    }
    if (parsed.protocol !== "smtp:" && parsed.protocol !== "smtps:") {
      throw new MailConfigError("SMTP_URL must start with smtp:// or smtps://");
    }
    return { transport: { url, ...TIMEOUTS }, from, description: `${parsed.protocol}//${parsed.host}` };
  }

  const explicitPort = parsePort(vars.SMTP_PORT);
  const secure = parseBoolean("SMTP_SECURE", vars.SMTP_SECURE) ?? explicitPort === 465;
  const port = explicitPort ?? (secure ? 465 : 587);
  const user = vars.SMTP_USER?.trim();
  return {
    transport: {
      host,
      port,
      secure,
      auth: user ? { user, pass: vars.SMTP_PASSWORD ?? "" } : undefined,
      ...TIMEOUTS,
    },
    from,
    description: `${host}:${port}${secure ? " (TLS)" : ""}`,
  };
}

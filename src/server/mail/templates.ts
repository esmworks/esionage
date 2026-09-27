import { createTranslator } from "next-intl";
import type { Locale } from "@/i18n/config";
import type { WorkspaceRole } from "@/db/schema";
import { emailMessages } from "@/i18n/messages/email";
import { env } from "@/lib/env";

export type EmailContent = {
  subject: string;
  heading: string;
  paragraphs: string[];
  /** Main call to action, rendered as a button with the plain link below it. */
  action?: { label: string; url: string };
};

export type RenderedEmail = { subject: string; text: string; html: string };

export function emailTranslator(locale: Locale) {
  return createTranslator({ locale, messages: emailMessages[locale] });
}

export function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeUrl(url: string) {
  const { protocol } = new URL(url);
  if (protocol !== "https:" && protocol !== "http:") throw new Error(`Refusing to put a ${protocol} link in an email`);
  return url;
}

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/** Plain-text and HTML versions of one email, in the shared layout. */
export function renderEmail(locale: Locale, content: EmailContent): RenderedEmail {
  const t = emailTranslator(locale);
  const footer = t("footer", { appUrl: env.appUrl });
  const action = content.action && { label: content.action.label, url: safeUrl(content.action.url) };

  const text = [
    content.heading,
    ...content.paragraphs,
    ...(action ? [`${action.label}: ${action.url}`] : []),
    `--\n${footer}`,
  ].join("\n\n");

  const paragraphs = content.paragraphs
    .map((p) => `<p style="margin:0 0 16px;">${escapeHtml(p)}</p>`)
    .join("\n");
  const button = action
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;">
<tr><td style="border-radius:6px;background:#2f6fed;">
<a href="${escapeHtml(action.url)}" style="display:inline-block;padding:10px 18px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">${escapeHtml(action.label)}</a>
</td></tr>
</table>
<p style="margin:0;font-size:13px;color:#6b6d75;">${escapeHtml(t("actionFallback"))}<br>
<a href="${escapeHtml(action.url)}" style="color:#2f6fed;word-break:break-all;">${escapeHtml(action.url)}</a></p>`
    : "";

  const html = `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(content.subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;">
<tr><td style="padding:32px;font-family:${FONT};font-size:15px;line-height:1.6;color:#1f2023;">
<p style="margin:0 0 24px;font-size:14px;font-weight:600;color:#6b6d75;">Esionage</p>
<h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;font-weight:600;">${escapeHtml(content.heading)}</h1>
${paragraphs}
${button}
</td></tr>
</table>
<p style="margin:16px 0 0;font-family:${FONT};font-size:12px;color:#9a9ca3;">${escapeHtml(footer)}</p>
</td></tr>
</table>
</body>
</html>`;

  return { subject: content.subject, text, html };
}

export function testEmail(locale: Locale): RenderedEmail {
  const t = emailTranslator(locale);
  return renderEmail(locale, {
    subject: t("test.subject"),
    heading: t("test.heading"),
    paragraphs: [t("test.body", { appUrl: env.appUrl })],
  });
}

export function invitationEmail(
  locale: Locale,
  invitation: { inviterName: string; workspaceName: string; email: string; role: WorkspaceRole; link: string },
): RenderedEmail {
  const t = emailTranslator(locale);
  const names = { inviter: invitation.inviterName, workspace: invitation.workspaceName };
  return renderEmail(locale, {
    subject: t("invitation.subject", names),
    heading: t("invitation.heading", names),
    paragraphs: [
      t("invitation.body", { ...names, role: t(`invitation.roles.${invitation.role}`) }),
      t("invitation.expires", { email: invitation.email }),
    ],
    action: { label: t("invitation.action"), url: invitation.link },
  });
}

export function assignmentEmail(
  locale: Locale,
  assignment: { actorName: string; rowTitle: string; databaseTitle: string; propertyName: string; link: string },
): RenderedEmail {
  const t = emailTranslator(locale);
  const names = {
    actor: assignment.actorName,
    row: assignment.rowTitle,
    database: assignment.databaseTitle,
    property: assignment.propertyName,
  };
  return renderEmail(locale, {
    subject: t("assignment.subject", names),
    heading: t("assignment.heading", names),
    paragraphs: [t("assignment.body", names), t("assignment.optOut")],
    action: { label: t("assignment.action"), url: assignment.link },
  });
}

export function shareEmail(
  locale: Locale,
  share: { actorName: string; pageTitle: string; workspaceName: string; level: "view" | "edit" | "full"; link: string },
): RenderedEmail {
  const t = emailTranslator(locale);
  const names = { actor: share.actorName, page: share.pageTitle, workspace: share.workspaceName };
  return renderEmail(locale, {
    subject: t("share.subject", names),
    heading: t("share.heading", names),
    paragraphs: [t("share.body", { ...names, level: t(`share.levels.${share.level}`) }), t("share.optOut")],
    action: { label: t("share.action"), url: share.link },
  });
}

/** Minutes a password reset link stays valid; also the Better Auth token lifetime. */
export const PASSWORD_RESET_MINUTES = 60;

export function passwordResetEmail(locale: Locale, reset: { name: string; url: string }): RenderedEmail {
  const t = emailTranslator(locale);
  return renderEmail(locale, {
    subject: t("passwordReset.subject"),
    heading: t("passwordReset.heading"),
    paragraphs: [
      t("passwordReset.body", { name: reset.name }),
      t("passwordReset.expires", { minutes: PASSWORD_RESET_MINUTES }),
    ],
    action: { label: t("passwordReset.action"), url: reset.url },
  });
}

"use server";

import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import type { AnswerError } from "@/lib/forms";
import { isDatabaseErrorCode, PropertyValueError } from "@/lib/properties";
import { AccessError } from "@/server/access";
import * as forms from "@/server/forms";
import { getSession, requireUserId } from "@/server/session";

/** A failed form action: a translated message, and for answers the message per question. */
export type FormActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; fields?: Record<string, string> };

const FIELD_CODES = ["required", "tooLong", "tooMany", "invalidText"] as const;

async function answerMessages(errors: AnswerError[]) {
  const t = await getTranslations();
  const fields: Record<string, string> = {};
  for (const { propertyId, code, params } of errors) {
    if ((FIELD_CODES as readonly string[]).includes(code)) {
      fields[propertyId] = t(`form.errors.${code as (typeof FIELD_CODES)[number]}`, params);
    } else if (isDatabaseErrorCode(code)) fields[propertyId] = t(`database.errors.${code}`, params);
    else fields[propertyId] = t("common.genericError");
  }
  return fields;
}

// Expected failures come back translated; anything else is logged and hidden behind the generic
// message, so query details never reach the browser.
async function run<T>(fn: () => Promise<T>): Promise<FormActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    const t = await getTranslations();
    if (error instanceof forms.FormError) {
      if (error.code === "invalidAnswers") {
        return { ok: false, error: t("form.errors.invalidAnswers"), fields: await answerMessages(error.answers) };
      }
      return { ok: false, error: t(`form.errors.${error.code}`) };
    }
    const { code, params } = error as { code?: unknown; params?: Record<string, string> };
    if (error instanceof PropertyValueError || error instanceof AccessError) {
      if (isDatabaseErrorCode(code)) return { ok: false, error: t(`database.errors.${code}`, params ?? {}) };
      return { ok: false, error: t("database.errors.accessDenied") };
    }
    console.error("[form action]", error);
    return { ok: false, error: t("common.genericError") };
  }
}

/** Fills in a form in the app; needs edit access to its database. */
export async function submitFormAction(viewId: string, answers: Record<string, unknown>) {
  const userId = await requireUserId();
  return run(() => forms.submitForm(userId, viewId, answers));
}

export async function getFormSharingAction(viewId: string) {
  const userId = await requireUserId();
  return run(() => forms.getFormSharing(userId, viewId));
}

/** Opens the form to the web, or changes whether it takes anonymous answers. */
export async function publishFormAction(viewId: string, anonymous: boolean) {
  const userId = await requireUserId();
  return run(() => forms.publishForm(userId, viewId, { anonymous }));
}

export async function unpublishFormAction(viewId: string) {
  const userId = await requireUserId();
  return run(() => forms.unpublishForm(userId, viewId));
}

/**
 * The client's address as the reverse proxy reports it (the first X-Forwarded-For entry), else
 * X-Real-IP. Only as trustworthy as the proxy in front of the app; without one, clients could
 * claim any address, and only the per-form limit holds.
 */
function clientIp(h: Headers) {
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (forwarded || h.get("x-real-ip")?.trim() || "unknown").slice(0, 100);
}

/** Answers a public form (`/f/<token>`), signed in or not. */
export async function submitPublicFormAction(token: string, submission: forms.PublicSubmission) {
  const [session, h] = await Promise.all([getSession(), headers()]);
  // Nothing comes back: a row id means nothing to the visitor, and an answer dropped as spam must
  // look the same as one that went in.
  return run(async () => {
    await forms.submitPublicForm(token, submission, { userId: session?.user.id ?? null, ip: clientIp(h) });
    return null;
  });
}

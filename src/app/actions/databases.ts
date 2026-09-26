"use server";

import { getTranslations } from "next-intl/server";
import type { PropertyType, SelectOption, ViewConfig, ViewType } from "@/db/schema";
import { isDatabaseErrorCode, PropertyValueError } from "@/lib/properties";
import { AccessError } from "@/server/access";
import * as databases from "@/server/databases";
import * as pages from "@/server/pages";
import { requireUserId } from "@/server/session";

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * Translates a domain error for the UI. Errors carry a stable `code` (plus `params`) next to their
 * English message, which stays as-is for MCP clients. Access errors without a code read as "not
 * found or no access"; anything else uncoded falls back to the generic message.
 */
async function errorMessage(error: Error): Promise<string> {
  const t = await getTranslations();
  const { code, params } = error as { code?: unknown; params?: Record<string, string> };
  if (isDatabaseErrorCode(code)) return t(`database.errors.${code}`, params ?? {});
  if (error instanceof AccessError) return t("database.errors.accessDenied");
  return t("common.genericError");
}

// Domain errors (validation, access, plain `new Error(...)` guards) become translated messages;
// driver/query errors are logged and hidden so SQL details never reach the client.
async function run<T>(fn: (userId: string) => Promise<T>): Promise<ActionResult<T>> {
  const userId = await requireUserId();
  try {
    return { ok: true, data: await fn(userId) };
  } catch (error) {
    if (
      error instanceof PropertyValueError ||
      error instanceof AccessError ||
      (error instanceof Error && error.constructor === Error)
    ) {
      return { ok: false, error: await errorMessage(error) };
    }
    console.error("[database action]", error);
    const t = await getTranslations("common");
    return { ok: false, error: t("genericError") };
  }
}

export async function loadDatabaseAction(databaseId: string) {
  return run((userId) => databases.getDatabaseSnapshot(userId, databaseId));
}

export async function loadRowAction(rowId: string) {
  return run((userId) => databases.getRow(userId, rowId));
}

export async function createRowAction(
  workspaceId: string,
  databaseId: string,
  input: { title?: string; properties?: Record<string, unknown> } = {},
) {
  return run(async (userId) => {
    const created = await pages.createPage(
      { userId },
      { workspaceId, parentId: databaseId, title: input.title, properties: input.properties },
    );
    return { id: created.id, position: created.position };
  });
}

export async function updateRowPropertiesAction(rowId: string, patch: Record<string, unknown>) {
  return run((userId) => databases.updateRowProperties(userId, rowId, patch));
}

export async function moveRowAction(
  rowId: string,
  move: { position?: number; groupBy?: string; groupValue?: string | null },
) {
  return run((userId) => databases.moveRow(userId, rowId, move));
}

export async function addPropertyAction(
  databaseId: string,
  input: { name: string; type: PropertyType; options?: string[] },
) {
  return run((userId) => databases.addProperty(userId, databaseId, input));
}

export async function updatePropertyAction(
  propertyId: string,
  patch: { name?: string; options?: SelectOption[]; position?: number },
) {
  return run((userId) => databases.updateProperty(userId, propertyId, patch));
}

export async function ensureOptionAction(propertyId: string, name: string) {
  return run((userId) => databases.ensureOption(userId, propertyId, name));
}

export async function deletePropertyAction(propertyId: string) {
  return run((userId) => databases.deleteProperty(userId, propertyId));
}

export async function addViewAction(databaseId: string, input: { name: string; type: ViewType }) {
  return run((userId) => databases.addView(userId, databaseId, input));
}

export async function updateViewAction(viewId: string, patch: { name?: string; config?: ViewConfig }) {
  return run((userId) => databases.updateView(userId, viewId, patch));
}

export async function deleteViewAction(viewId: string) {
  return run((userId) => databases.deleteView(userId, viewId));
}

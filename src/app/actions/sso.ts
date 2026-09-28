"use server";

import { revalidatePath } from "next/cache";
import { AccessError } from "@/server/access";
import { createScimToken, revokeScimToken, ScimTokenError } from "@/server/scim";
import { requireUserId } from "@/server/session";
import {
  removeSsoConnection,
  saveSsoConnection,
  SsoError,
  verifySsoDomains,
  type SsoConnection,
  type SsoConnectionInput,
  type SsoErrorCode,
} from "@/server/sso";

export type SsoActionError = SsoErrorCode | ScimTokenError["code"] | "ownersOnly" | "generic";
export type SsoActionResult<T> = { ok: true; data: T } | { ok: false; error: SsoActionError; detail?: string };

const refresh = (workspaceId: string) => revalidatePath(`/w/${workspaceId}/settings`, "page");

/** Expected failures come back as codes the settings box translates; anything else is logged. */
async function run<T>(workspaceId: string, fn: () => Promise<T>): Promise<SsoActionResult<T>> {
  try {
    const data = await fn();
    refresh(workspaceId);
    return { ok: true, data };
  } catch (error) {
    if (error instanceof SsoError) return { ok: false, error: error.code, detail: error.detail };
    if (error instanceof ScimTokenError) return { ok: false, error: error.code };
    if (error instanceof AccessError) return { ok: false, error: "ownersOnly" };
    console.error("single sign-on settings failed", error);
    return { ok: false, error: "generic" };
  }
}

function cleanInput(input: SsoConnectionInput): SsoConnectionInput {
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  if (input?.protocol === "saml") {
    return {
      protocol: "saml",
      metadataXml: text(input.metadataXml),
      entryPoint: text(input.entryPoint),
      idpEntityId: text(input.idpEntityId),
      certificate: text(input.certificate),
      domains: text(input.domains),
    };
  }
  return {
    protocol: "oidc",
    issuer: text(input?.issuer),
    clientId: text(input?.clientId),
    clientSecret: text(input?.clientSecret),
    domains: text(input?.domains),
  };
}

export async function saveSsoConnectionAction(workspaceId: string, input: SsoConnectionInput) {
  const userId = await requireUserId();
  return run<SsoConnection | null>(workspaceId, () => saveSsoConnection(userId, String(workspaceId), cleanInput(input)));
}

export async function verifySsoDomainsAction(workspaceId: string) {
  const userId = await requireUserId();
  return run<SsoConnection | null>(workspaceId, () => verifySsoDomains(userId, String(workspaceId)));
}

export async function removeSsoConnectionAction(workspaceId: string) {
  const userId = await requireUserId();
  return run(workspaceId, () => removeSsoConnection(userId, String(workspaceId)));
}

/** Creates a SCIM token; its secret comes back once and is never shown again. */
export async function createScimTokenAction(workspaceId: string, name: string) {
  const userId = await requireUserId();
  return run(workspaceId, async () => (await createScimToken(userId, String(workspaceId), String(name ?? ""))).secret);
}

export async function revokeScimTokenAction(workspaceId: string, tokenId: string) {
  const userId = await requireUserId();
  return run(workspaceId, () => revokeScimToken(userId, String(workspaceId), String(tokenId)));
}

"use server";

import { revalidatePath } from "next/cache";
import { ApiTokenError, createApiToken, revokeApiToken } from "@/server/api/tokens";
import { requireUserId } from "@/server/session";

export type CreateApiTokenResult = { ok: true; secret: string } | { ok: false; error: ApiTokenError["code"] | "generic" };

/** Creates a personal access token; its secret comes back once and is never shown again. */
export async function createApiTokenAction(input: {
  name: string;
  write: boolean;
  workspaceId: string | null;
  expiresInDays: number | null;
}): Promise<CreateApiTokenResult> {
  const userId = await requireUserId();
  try {
    const { secret } = await createApiToken(userId, {
      name: String(input.name ?? ""),
      scopes: input.write ? ["pages:read", "pages:write"] : ["pages:read"],
      workspaceId: input.workspaceId,
      expiresInDays: input.expiresInDays,
    });
    revalidatePath("/w/[workspaceId]/settings", "page");
    return { ok: true, secret };
  } catch (error) {
    if (error instanceof ApiTokenError) return { ok: false, error: error.code };
    console.error("could not create an API token", error);
    return { ok: false, error: "generic" };
  }
}

export async function revokeApiTokenAction(tokenId: string) {
  const userId = await requireUserId();
  await revokeApiToken(userId, String(tokenId));
  revalidatePath("/w/[workspaceId]/settings", "page");
}

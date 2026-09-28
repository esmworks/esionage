"use server";

import { revalidatePath } from "next/cache";
import type { SharingErrorCode, SharingResult } from "@/app/actions/sharing";
import { isApprovalLevel } from "@/lib/access-requests";
import { AccessError } from "@/server/access";
import {
  approveAccessRequest,
  declineAccessRequest,
  requestPageAccess,
  type AccessRequestOutcome,
} from "@/server/access-requests";
import { getCollab } from "@/server/collab/bridge";
import { PermissionError } from "@/server/permissions";
import { requireUserId } from "@/server/session";

/** From the "You don't have access" screen: the same answer whether or not the page exists. */
export async function requestAccessAction(pageId: string, message: string): Promise<AccessRequestOutcome> {
  const userId = await requireUserId();
  if (typeof pageId !== "string" || !pageId) return "sent";
  return requestPageAccess(userId, pageId, message);
}

async function answer(run: (userId: string) => Promise<{ workspaceId: string }>): Promise<SharingResult> {
  const userId = await requireUserId();
  let workspaceId: string;
  try {
    ({ workspaceId } = await run(userId));
  } catch (error) {
    if (error instanceof PermissionError) return { ok: false, code: error.code satisfies SharingErrorCode };
    if (error instanceof AccessError) return { ok: false, code: "accessDenied" };
    console.error("[access request action]", error);
    return { ok: false, code: "generic" };
  }
  // Sidebars refetch the tree: the requester may see the page now.
  getCollab().broadcast(`ws:${workspaceId}`, "tree");
  revalidatePath(`/w/${workspaceId}`, "layout");
  return { ok: true };
}

/** Shares the page with the requester at `level`, bringing them in as a guest when they are outside. */
export async function approveAccessRequestAction(requestId: string, level: string): Promise<SharingResult> {
  if (!isApprovalLevel(level)) return { ok: false, code: "generic" };
  return answer((userId) => approveAccessRequest(userId, requestId, level));
}

export async function declineAccessRequestAction(requestId: string): Promise<SharingResult> {
  return answer((userId) => declineAccessRequest(userId, requestId));
}

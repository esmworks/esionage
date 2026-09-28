import { revalidatePath } from "next/cache";

/**
 * After a change to the person's own account: the pages that show it, the account page and the
 * account tabs under every workspace's Settings (see components/account/account-tabs).
 */
export function revalidateAccountPages() {
  revalidatePath("/account");
  revalidatePath("/w/[workspaceId]/settings", "page");
}

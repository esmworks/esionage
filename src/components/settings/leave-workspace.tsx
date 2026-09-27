"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { removeMemberAction } from "@/app/actions/workspaces";
import { Button, Dialog } from "@/components/ui";
import { SettingsRow } from "./section";
import { useAction } from "./workspace-settings";

/**
 * Leaving the workspace outside the members list, for guests, who can't open it. Same action,
 * wording and redirect as "Leave" in a member row.
 */
export function LeaveWorkspaceRow({ workspaceId, userId }: { workspaceId: string; userId: string }) {
  const t = useTranslations("settings.leaveWorkspace");
  const [confirm, setConfirm] = useState(false);
  return (
    <>
      <SettingsRow
        title={t("title")}
        description={t("description")}
        control={
          <Button variant="danger" onClick={() => setConfirm(true)}>
            {t("button")}
          </Button>
        }
      />
      {confirm && <LeaveDialog workspaceId={workspaceId} userId={userId} onClose={() => setConfirm(false)} />}
    </>
  );
}

function LeaveDialog({ workspaceId, userId, onClose }: { workspaceId: string; userId: string; onClose: () => void }) {
  const router = useRouter();
  const t = useTranslations("settings.members");
  const tc = useTranslations("common");
  const { pending, error, run } = useAction();
  return (
    <Dialog open onClose={onClose} className="max-w-md">
      <div className="space-y-3 p-5">
        <h2 className="text-base font-semibold">{t("leaveTitle")}</h2>
        <p className="text-sm text-fg-muted">{t("leaveBody")}</p>
        {error && <p className="text-xs text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {tc("cancel")}
          </Button>
          <Button
            variant="danger"
            disabled={pending}
            onClick={() =>
              run(
                () => removeMemberAction(workspaceId, userId),
                () => {
                  onClose();
                  router.push("/");
                  router.refresh();
                },
              )
            }
          >
            {t("leave")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { updateWorkspaceSettingsAction } from "@/app/actions/workspaces";
import type { WorkspaceSettings } from "@/db/schema";
import { SettingsRow } from "./section";
import { selectClass, useAction } from "./workspace-settings";

/** Settings > Security: workspace policies. Owners change them; members see what is set. */
export function GuestInviteSetting({
  workspaceId,
  settings,
  canEdit,
}: {
  workspaceId: string;
  settings: WorkspaceSettings;
  canEdit: boolean;
}) {
  const t = useTranslations("settings.security");
  const [value, setValue] = useState(settings.guestInvites);
  const { pending, error, run } = useAction();

  return (
    <SettingsRow
      title={t("guestInvites.title")}
      htmlFor="guest-invites"
      description={
        error ? (
          <span className="text-danger">{error}</span>
        ) : (
          <>
            {t("guestInvites.description")}
            {!canEdit && <> {t("ownersOnly")}</>}
          </>
        )
      }
      control={
        <select
          id="guest-invites"
          className={selectClass}
          value={value}
          disabled={!canEdit || pending}
          onChange={(e) => {
            const next = e.target.value as WorkspaceSettings["guestInvites"];
            const previous = value;
            setValue(next);
            run(
              async () => {
                const result = await updateWorkspaceSettingsAction(workspaceId, { guestInvites: next });
                if (!result.ok) setValue(previous);
                return result;
              },
            );
          }}
        >
          <option value="owners">{t("guestInvites.owners")}</option>
          <option value="members">{t("guestInvites.members")}</option>
        </select>
      }
    />
  );
}

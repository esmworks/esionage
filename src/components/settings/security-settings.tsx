"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { updateWorkspaceSettingsAction } from "@/app/actions/workspaces";
import { Switch } from "@/components/ui";
import type { WorkspaceSettings } from "@/db/schema";
import { SettingsRow } from "./section";
import { selectClass, useAction } from "./workspace-settings";

type RoleSetting = "guestInvites" | "publishing";

/** Settings > Security: a policy that lets owners only, or owners and members, do something. */
function RoleSettingSelect({
  workspaceId,
  settings,
  canEdit,
  setting,
}: {
  workspaceId: string;
  settings: WorkspaceSettings;
  canEdit: boolean;
  setting: RoleSetting;
}) {
  const t = useTranslations("settings.security");
  const [value, setValue] = useState(settings[setting]);
  const { pending, error, run } = useAction();
  const id = setting === "guestInvites" ? "guest-invites" : "publishing";

  return (
    <SettingsRow
      title={t(`${setting}.title`)}
      htmlFor={id}
      description={
        error ? (
          <span className="text-danger">{error}</span>
        ) : (
          <>
            {t(`${setting}.description`)}
            {!canEdit && <> {t("ownersOnly")}</>}
          </>
        )
      }
      control={
        <select
          id={id}
          className={selectClass}
          value={value}
          disabled={!canEdit || pending}
          onChange={(e) => {
            const next = e.target.value as WorkspaceSettings[RoleSetting];
            const previous = value;
            setValue(next);
            run(async () => {
              const result = await updateWorkspaceSettingsAction(workspaceId, { [setting]: next });
              if (!result.ok) setValue(previous);
              return result;
            });
          }}
        >
          <option value="owners">{t(`${setting}.owners`)}</option>
          <option value="members">{t(`${setting}.members`)}</option>
        </select>
      }
    />
  );
}

/** Settings > Security: workspace policies. Owners change them; members see what is set. */
export function GuestInviteSetting(props: { workspaceId: string; settings: WorkspaceSettings; canEdit: boolean }) {
  return <RoleSettingSelect {...props} setting="guestInvites" />;
}

export function PublishingSetting(props: { workspaceId: string; settings: WorkspaceSettings; canEdit: boolean }) {
  return <RoleSettingSelect {...props} setting="publishing" />;
}

/** Whether guests may add top-level pages that only they can see. */
export function GuestPrivatePagesSetting({
  workspaceId,
  settings,
  canEdit,
}: {
  workspaceId: string;
  settings: WorkspaceSettings;
  canEdit: boolean;
}) {
  const t = useTranslations("settings.security");
  const [value, setValue] = useState(settings.guestPrivatePages);
  const { pending, error, run } = useAction();

  return (
    <SettingsRow
      title={t("guestPrivatePages.title")}
      description={
        error ? (
          <span className="text-danger">{error}</span>
        ) : (
          <>
            {t("guestPrivatePages.description")}
            {!canEdit && <> {t("ownersOnly")}</>}
          </>
        )
      }
      control={
        <Switch
          checked={value}
          label={t("guestPrivatePages.title")}
          disabled={!canEdit || pending}
          onChange={(next) => {
            setValue(next);
            run(async () => {
              const result = await updateWorkspaceSettingsAction(workspaceId, { guestPrivatePages: next });
              if (!result.ok) setValue(!next);
              return result;
            });
          }}
        />
      }
    />
  );
}

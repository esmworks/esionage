"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { updateWorkspaceSettingsAction } from "@/app/actions/workspaces";
import { Switch } from "@/components/ui";
import type { WorkspaceSettings } from "@/db/schema";
import { HISTORY_RETENTION, TRASH_RETENTION_CHOICES } from "@/lib/retention";
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

/**
 * Whether everyone must use two-step verification to open the workspace. Turning it on needs the
 * owner's own session to pass it, so they can't shut themselves out; the server checks it too.
 */
export function RequireTwoFactorSetting({
  workspaceId,
  settings,
  canEdit,
  ownSessionPasses,
  withoutTwoFactor,
}: {
  workspaceId: string;
  settings: WorkspaceSettings;
  canEdit: boolean;
  /** The owner's current session counts as two-step (authenticator app on, or a passkey sign-in). */
  ownSessionPasses: boolean;
  /** People in the workspace with neither an authenticator app nor a passkey (owners only). */
  withoutTwoFactor: number;
}) {
  const t = useTranslations("settings.security.requireTwoFactor");
  const ts = useTranslations("settings.security");
  const [value, setValue] = useState(settings.requireTwoFactor);
  const { pending, error, run } = useAction();
  const blocked = !value && !ownSessionPasses;

  return (
    <SettingsRow
      title={t("title")}
      description={
        error ? (
          <span className="text-danger">{error}</span>
        ) : (
          <>
            {t("description")}
            {!canEdit && <> {ts("ownersOnly")}</>}
            {canEdit && blocked && (
              <>
                {" "}
                <Link href={`/account?tab=security&from=${encodeURIComponent(workspaceId)}`} className="text-accent hover:underline">
                  {t("setUpFirst")}
                </Link>
              </>
            )}
            {canEdit && !blocked && withoutTwoFactor > 0 && <> {t("withoutCount", { count: withoutTwoFactor })}</>}
          </>
        )
      }
      control={
        <Switch
          checked={value}
          label={t("title")}
          disabled={!canEdit || pending || blocked}
          onChange={(next) => {
            setValue(next);
            run(async () => {
              const result = await updateWorkspaceSettingsAction(workspaceId, { requireTwoFactor: next });
              if (!result.ok) setValue(!next);
              return result;
            });
          }}
        />
      }
    />
  );
}

/** Settings > Security: how long pages stay in the trash before the daily cleanup deletes them. */
export function TrashRetentionSetting({
  workspaceId,
  settings,
  canEdit,
}: {
  workspaceId: string;
  settings: WorkspaceSettings;
  canEdit: boolean;
}) {
  const t = useTranslations("settings.security.trashRetention");
  const ts = useTranslations("settings.security");
  const [value, setValue] = useState(settings.trashRetentionDays);
  const { pending, error, run } = useAction();

  return (
    <SettingsRow
      title={t("title")}
      htmlFor="trash-retention"
      description={
        error ? (
          <span className="text-danger">{error}</span>
        ) : (
          <>
            {t("description")}
            {!canEdit && <> {ts("ownersOnly")}</>}
          </>
        )
      }
      control={
        <select
          id="trash-retention"
          className={selectClass}
          value={value}
          disabled={!canEdit || pending}
          onChange={(e) => {
            const next = Number(e.target.value);
            const previous = value;
            setValue(next);
            run(async () => {
              const result = await updateWorkspaceSettingsAction(workspaceId, { trashRetentionDays: next });
              if (!result.ok) setValue(previous);
              return result;
            });
          }}
        >
          {TRASH_RETENTION_CHOICES.map((days) => (
            <option key={days} value={days}>
              {days === 0 ? t("never") : t("days", { count: days })}
            </option>
          ))}
        </select>
      }
    />
  );
}

/** Settings > Security: the page history rules, the same for every workspace. */
export function HistoryRetentionNote() {
  const t = useTranslations("settings.security.historyRetention");
  return (
    <SettingsRow
      title={t("title")}
      description={t("description", {
        days: HISTORY_RETENTION.maxAgeDays,
        count: HISTORY_RETENTION.maxPerPage,
        keptDays: HISTORY_RETENTION.keptAgeDays,
      })}
    />
  );
}

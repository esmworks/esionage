"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { updateWorkspaceSettingsAction } from "@/app/actions/workspaces";
import { Switch } from "@/components/ui";
import type { WorkspaceSettings } from "@/db/schema";
import { SettingsRow } from "./section";
import { selectClass, useAction } from "./workspace-settings";

/** The settings chosen from a list: who may do something, or how far connected apps go. */
type ChoiceSetting = "guestInvites" | "publishing" | "connectedApps";

/** Each setting's choices, with the message naming each (under settings.security). */
const CHOICES = {
  guestInvites: {
    id: "guest-invites",
    options: [
      ["owners", "guestInvites.owners"],
      ["members", "guestInvites.members"],
    ],
  },
  publishing: {
    id: "publishing",
    options: [
      ["owners", "publishing.owners"],
      ["members", "publishing.members"],
      ["off", "publishing.off"],
    ],
  },
  connectedApps: {
    id: "connected-apps",
    options: [
      ["full", "connectedApps.full"],
      ["read", "connectedApps.read"],
      ["off", "connectedApps.off"],
    ],
  },
} as const satisfies { [K in ChoiceSetting]: { id: string; options: readonly (readonly [WorkspaceSettings[K], string])[] } };

/** Settings > Security: a policy picked from a few choices, each with its own label. */
function ChoiceSettingSelect({
  workspaceId,
  settings,
  canEdit,
  setting,
}: {
  workspaceId: string;
  settings: WorkspaceSettings;
  canEdit: boolean;
  setting: ChoiceSetting;
}) {
  const t = useTranslations("settings.security");
  const [value, setValue] = useState<string>(settings[setting]);
  const { pending, error, run } = useAction();
  const { id, options } = CHOICES[setting];

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
            const next = e.target.value;
            const previous = value;
            setValue(next);
            run(async () => {
              const result = await updateWorkspaceSettingsAction(workspaceId, { [setting]: next });
              if (!result.ok) setValue(previous);
              return result;
            });
          }}
        >
          {options.map(([option, label]) => (
            <option key={option} value={option}>
              {t(label)}
            </option>
          ))}
        </select>
      }
    />
  );
}

/** Settings > Security: workspace policies. Owners change them; members see what is set. */
export function GuestInviteSetting(props: { workspaceId: string; settings: WorkspaceSettings; canEdit: boolean }) {
  return <ChoiceSettingSelect {...props} setting="guestInvites" />;
}

/** Owners only, owners and members, or nobody: off also takes what is published off the web. */
export function PublishingSetting(props: { workspaceId: string; settings: WorkspaceSettings; canEdit: boolean }) {
  return <ChoiceSettingSelect {...props} setting="publishing" />;
}

/** What MCP clients and REST API tokens may do here: everything their user may, read, or nothing. */
export function ConnectedAppsSetting(props: { workspaceId: string; settings: WorkspaceSettings; canEdit: boolean }) {
  return <ChoiceSettingSelect {...props} setting="connectedApps" />;
}

/** Whether people may export pages (Markdown, CSV, ZIP) and print them to PDF. */
export function ExportSetting({
  workspaceId,
  settings,
  canEdit,
}: {
  workspaceId: string;
  settings: WorkspaceSettings;
  canEdit: boolean;
}) {
  const t = useTranslations("settings.security");
  const [value, setValue] = useState(settings.export !== false);
  const { pending, error, run } = useAction();

  return (
    <SettingsRow
      title={t("export.title")}
      description={
        error ? (
          <span className="text-danger">{error}</span>
        ) : (
          <>
            {t("export.description")}
            {!canEdit && <> {t("ownersOnly")}</>}
          </>
        )
      }
      control={
        <Switch
          checked={value}
          label={t("export.title")}
          disabled={!canEdit || pending}
          onChange={(next) => {
            setValue(next);
            run(async () => {
              const result = await updateWorkspaceSettingsAction(workspaceId, { export: next });
              if (!result.ok) setValue(!next);
              return result;
            });
          }}
        />
      }
    />
  );
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

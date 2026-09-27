"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { updateWorkspaceSettingsAction } from "@/app/actions/workspaces";
import { Switch } from "@/components/ui";
import { SettingsRow } from "./section";
import { useAction } from "./workspace-settings";

/**
 * Settings > General > AI: owners turn the workspace's AI features on or off; everyone sees which
 * provider and model the server uses. Without a provider on the server there is nothing to turn on.
 */
export function AiSettings({
  workspaceId,
  enabled,
  canEdit,
  provider,
}: {
  workspaceId: string;
  enabled: boolean;
  canEdit: boolean;
  /** The server's AI provider and model; null when none is set up. */
  provider: { provider: string; model: string } | null;
}) {
  const t = useTranslations("ai.settings");
  const [value, setValue] = useState(enabled);
  const { pending, error, run } = useAction();

  if (!provider) {
    return <SettingsRow title={t("enabled")} description={t("notConfigured")} />;
  }
  return (
    <>
      <SettingsRow
        title={t("enabled")}
        description={
          error ? (
            <span className="text-danger">{error}</span>
          ) : (
            <>
              {t("enabledHint")}
              {!canEdit && <> {t("ownersOnly")}</>}
            </>
          )
        }
        control={
          <Switch
            checked={value}
            label={t("enabled")}
            disabled={!canEdit || pending}
            onChange={(next) => {
              setValue(next);
              run(async () => {
                const result = await updateWorkspaceSettingsAction(workspaceId, { ai: next });
                if (!result.ok) setValue(!next);
                return result;
              });
            }}
          />
        }
      />
      <SettingsRow title={t("provider")} description={t("providerValue", { provider: provider.provider, model: provider.model })} />
    </>
  );
}

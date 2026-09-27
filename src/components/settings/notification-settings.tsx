"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { setAssignmentEmailsAction } from "@/app/actions/preferences";
import { Switch } from "@/components/ui";
import { SettingsRow } from "./section";

/** Settings > Preferences: whether to get an email when someone assigns you to a row. */
export function AssignmentEmailSetting({ enabled, mailOff }: { enabled: boolean; mailOff: boolean }) {
  const t = useTranslations("settings.notifications");
  const tc = useTranslations("common");
  const [value, setValue] = useState(enabled);
  const [error, setError] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <SettingsRow
      title={t("assignmentTitle")}
      description={
        error ? (
          <span className="text-danger">{tc("genericError")}</span>
        ) : (
          <>
            {t("assignmentDescription")}
            {mailOff && <> {t("mailOff")}</>}
          </>
        )
      }
      control={
        <Switch
          checked={value}
          label={t("assignmentTitle")}
          disabled={pending}
          onChange={(next) => {
            setValue(next);
            setError(false);
            startTransition(async () => {
              try {
                await setAssignmentEmailsAction(next);
              } catch {
                setValue(!next);
                setError(true);
              }
            });
          }}
        />
      }
    />
  );
}

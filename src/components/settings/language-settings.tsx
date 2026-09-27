"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { setLocaleAction } from "@/app/actions/locale";
import { LOCALE_NAMES, LOCALES, type Locale } from "@/i18n/config";
import { cn } from "@/components/ui";
import { SettingsRow } from "./section";
import { selectClass } from "./workspace-settings";

// Each language by its own name, in alphabetical order.
const SORTED_LOCALES = [...LOCALES].sort((a, b) => LOCALE_NAMES[a].localeCompare(LOCALE_NAMES[b], "en"));

/** Interface language for this browser, stored in a cookie; empty means "follow the browser". */
export function LanguageSettings({ current }: { current: Locale | null }) {
  const t = useTranslations("settings.language");
  const tc = useTranslations("common");
  const router = useRouter();
  const [value, setValue] = useState(current ?? "");
  const [error, setError] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <SettingsRow
      title={t("label")}
      htmlFor="interface-language"
      description={error ? <span className="text-danger">{tc("genericError")}</span> : t("note")}
      control={
        <select
          id="interface-language"
          className={cn(selectClass, "min-w-44")}
          value={value}
          disabled={pending}
          onChange={(e) => {
            const next = e.target.value;
            const previous = value;
            setValue(next);
            setError(false);
            startTransition(async () => {
              try {
                await setLocaleAction(next || null);
                router.refresh();
              } catch {
                // Not saved: show the language that is still in effect.
                setValue(previous);
                setError(true);
              }
            });
          }}
        >
          <option value="">{t("followBrowser")}</option>
          {SORTED_LOCALES.map((locale) => (
            <option key={locale} value={locale} lang={locale}>
              {LOCALE_NAMES[locale]}
            </option>
          ))}
        </select>
      }
    />
  );
}

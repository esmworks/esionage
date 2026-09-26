"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { setLocaleAction } from "@/app/actions/locale";
import { LOCALE_NAMES, LOCALES, type Locale } from "@/i18n/config";
import { selectClass } from "./workspace-settings";

/** Interface language for this browser, stored in a cookie; empty means "follow the browser". */
export function LanguageSettings({ current }: { current: Locale | null }) {
  const t = useTranslations("settings.language");
  const tc = useTranslations("common");
  const router = useRouter();
  const [value, setValue] = useState(current ?? "");
  const [error, setError] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold">{t("heading")}</h2>
      <div className="space-y-1.5">
        <label htmlFor="interface-language" className="text-sm text-fg-muted">
          {t("label")}
        </label>
        <div>
          <select
            id="interface-language"
            className={selectClass}
            value={value}
            disabled={pending}
            onChange={(e) => {
              const next = e.target.value;
              setValue(next);
              setError(false);
              startTransition(async () => {
                try {
                  await setLocaleAction(next || null);
                  router.refresh();
                } catch {
                  setError(true);
                }
              });
            }}
          >
            <option value="">{t("followBrowser")}</option>
            {LOCALES.map((locale) => (
              <option key={locale} value={locale} lang={locale}>
                {LOCALE_NAMES[locale]}
              </option>
            ))}
          </select>
        </div>
        {error && <p className="text-xs text-danger">{tc("genericError")}</p>}
        <p className="text-xs text-fg-muted">{t("note")}</p>
      </div>
    </section>
  );
}

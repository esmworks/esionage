"use client";

import { Check, Copy } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button, Input } from "@/components/ui";

/**
 * `navigator.clipboard` only exists on secure origins (https, localhost), so on a plain-http LAN
 * address it is undefined; fall back to the older execCommand copy from a hidden textarea.
 */
export async function copyText(value: string, returnFocus: HTMLElement) {
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Denied or unavailable: try the fallback below.
  }
  const area = document.createElement("textarea");
  area.value = value;
  area.readOnly = true;
  area.setAttribute("aria-hidden", "true");
  area.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none";
  document.body.appendChild(area);
  try {
    area.select();
    area.setSelectionRange(0, value.length);
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    area.remove();
    returnFocus.focus();
  }
}

export function CopyButton({ value, label: customLabel }: { value: string; label?: string }) {
  const tc = useTranslations("common");
  const t = useTranslations("settings");
  const label = customLabel ?? tc("copy");
  const [copied, setCopied] = useState(false);
  // Copying failed entirely: show the text so it can be copied by hand.
  const [manual, setManual] = useState(false);
  return (
    <>
      {manual && (
        <Input
          readOnly
          autoFocus
          value={value}
          aria-label={t("copyManually")}
          title={t("copyManually")}
          className="w-48 sm:w-64"
          onFocus={(e) => e.currentTarget.select()}
        />
      )}
      <Button
        size="sm"
        className="shrink-0 whitespace-nowrap"
        aria-label={`${label}: ${value}`}
        onClick={async (e) => {
          const button = e.currentTarget;
          if (await copyText(value, button)) {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } else {
            setCopied(false);
            setManual(true);
          }
        }}
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        {copied ? tc("copied") : label}
      </Button>
    </>
  );
}

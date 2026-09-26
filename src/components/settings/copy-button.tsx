"use client";

import { Check, Copy } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui";

export function CopyButton({ value, label: customLabel }: { value: string; label?: string }) {
  const tc = useTranslations("common");
  const label = customLabel ?? tc("copy");
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      className="shrink-0 whitespace-nowrap"
      aria-label={`${label}: ${value}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? tc("copied") : label}
    </Button>
  );
}

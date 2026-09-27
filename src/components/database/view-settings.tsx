"use client";

import { Check, SlidersHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { MenuSeparator } from "@/components/ui";
import type { ViewConfig } from "@/db/schema/app";
import { CARD_SIZES, COVER_SOURCES, galleryCover } from "@/lib/views";
import { Floating, useFloating } from "./floating";
import type { View } from "./types";

/** Layout settings of gallery views (card size and cover). */
export function ViewLayoutMenu({
  view,
  onConfig,
  readOnly,
}: {
  view: View;
  onConfig: (config: ViewConfig) => void;
  readOnly?: boolean;
}) {
  const t = useTranslations("database.layout");
  const menu = useFloating<HTMLButtonElement>();
  if (readOnly || view.type !== "gallery") return null;
  const config = view.config;
  const set = (patch: ViewConfig) => onConfig({ ...config, ...patch });

  return (
    <>
      <button
        ref={menu.ref}
        type="button"
        title={t("label")}
        aria-label={t("label")}
        onClick={menu.toggle}
        className="inline-flex h-7 min-w-7 items-center justify-center rounded-md px-1.5 text-fg-muted hover:bg-bg-hover hover:text-fg"
      >
        <SlidersHorizontal className="h-4 w-4" />
      </button>
      <Floating open={menu.open} anchor={menu.el} onClose={menu.close} align="end">
        <div className="max-h-[70vh] w-64 overflow-y-auto">
          <Heading>{t("cardSize")}</Heading>
          {CARD_SIZES.map((size) => (
            <Choice key={size} active={(config.cardSize ?? "medium") === size} onClick={() => set({ cardSize: size })}>
              {t(`cardSizes.${size}`)}
            </Choice>
          ))}
          <MenuSeparator />
          <Heading>{t("cover")}</Heading>
          {COVER_SOURCES.map((source) => (
            <Choice key={source} active={galleryCover(config) === source} onClick={() => set({ cover: { source } })}>
              {t(`covers.${source}`)}
            </Choice>
          ))}
        </div>
      </Floating>
    </>
  );
}

function Heading({ children }: { children: ReactNode }) {
  return <div className="px-2 pt-1 pb-1.5 text-xs text-fg-muted">{children}</div>;
}

/** A menu entry of a one-of-several setting, ticked when chosen. */
function Choice({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={active}
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-bg-hover"
    >
      <span className="flex-1 truncate">{children}</span>
      {active && <Check className="h-3.5 w-3.5 text-fg-muted" />}
    </button>
  );
}

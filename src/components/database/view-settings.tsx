"use client";

import { Check, Plus, SlidersHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { cn, MenuItem, MenuSeparator } from "@/components/ui";
import type { ViewConfig } from "@/db/schema/app";
import { isGroupable } from "@/lib/properties";
import { holdsTimestamp } from "@/lib/property-types";
import { CARD_SIZES, COVER_SOURCES, galleryCover } from "@/lib/views";
import { Floating, useFloating } from "./floating";
import { PropertyTypeIcon } from "./property-icons";
import type { Property, View } from "./types";

/** Date properties a timeline can start bars at (created and edited times are read-only there). */
export function timelineStartProps(properties: Property[]) {
  return properties.filter((p) => p.type === "date" || holdsTimestamp(p.type));
}

/**
 * The timeline's start and end properties: the saved ones, else the first date property. An end
 * equal to the start (or not a date) counts as none.
 */
export function timelineDates(view: View, properties: Property[]) {
  const starts = timelineStartProps(properties);
  const start =
    starts.find((p) => p.id === view.config.dateBy) ?? starts.find((p) => p.type === "date") ?? null;
  const end =
    properties.find((p) => p.id === view.config.endDateBy && p.type === "date" && p.id !== start?.id) ?? null;
  return { start, end };
}

/** The timeline's swimlane property, when it has one that can still group. */
export function timelineGroupProperty(view: View, properties: Property[]) {
  return properties.find((p) => p.id === view.config.groupBy && isGroupable(p.type)) ?? null;
}

/** Layout settings of gallery and timeline views (card size and cover; dates, swimlanes and table). */
export function ViewLayoutMenu({
  view,
  properties,
  onConfig,
  onCreateDateProperty,
  readOnly,
  locked,
}: {
  view: View;
  properties: Property[];
  onConfig: (config: ViewConfig) => void;
  onCreateDateProperty: () => void;
  readOnly?: boolean;
  locked?: boolean;
}) {
  const t = useTranslations("database.layout");
  const menu = useFloating<HTMLButtonElement>();
  if (readOnly || (view.type !== "gallery" && view.type !== "timeline")) return null;
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
          {view.type === "gallery" ? (
            <>
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
            </>
          ) : (
            <TimelineSettings
              view={view}
              properties={properties}
              locked={locked}
              onSet={set}
              onCreateDateProperty={() => {
                menu.close();
                onCreateDateProperty();
              }}
            />
          )}
        </div>
      </Floating>
    </>
  );
}

function TimelineSettings({
  view,
  properties,
  locked,
  onSet,
  onCreateDateProperty,
}: {
  view: View;
  properties: Property[];
  locked?: boolean;
  onSet: (patch: ViewConfig) => void;
  onCreateDateProperty: () => void;
}) {
  const t = useTranslations("database.layout");
  const { start, end } = timelineDates(view, properties);
  const groupBy = timelineGroupProperty(view, properties);
  const starts = timelineStartProps(properties);
  const ends = properties.filter((p) => p.type === "date" && p.id !== start?.id);
  const groupable = properties.filter((p) => isGroupable(p.type));
  const showTable = view.config.showTable !== false;
  return (
    <>
      <Heading>{t("start")}</Heading>
      {starts.map((p) => (
        <MenuItem
          key={p.id}
          active={p.id === start?.id}
          icon={<PropertyTypeIcon type={p.type} />}
          onClick={() => onSet({ dateBy: p.id, endDateBy: p.id === end?.id ? undefined : view.config.endDateBy })}
        >
          {p.name}
        </MenuItem>
      ))}
      {!starts.length && <p className="px-2 pb-1 text-xs text-fg-faint">{t("needsDate")}</p>}
      <MenuSeparator />
      <Heading>{t("end")}</Heading>
      <Choice active={!end} onClick={() => onSet({ endDateBy: undefined })}>
        {t("noEnd")}
      </Choice>
      {ends.map((p) => (
        <MenuItem key={p.id} active={p.id === end?.id} icon={<PropertyTypeIcon type={p.type} />} onClick={() => onSet({ endDateBy: p.id })}>
          {p.name}
        </MenuItem>
      ))}
      {!locked && (
        <MenuItem icon={<Plus className="h-3.5 w-3.5" />} onClick={onCreateDateProperty}>
          {t("newDateProperty")}
        </MenuItem>
      )}
      <MenuSeparator />
      <Heading>{t("groupBy")}</Heading>
      <Choice active={!groupBy} onClick={() => onSet({ groupBy: undefined })}>
        {t("noGrouping")}
      </Choice>
      {groupable.map((p) => (
        <MenuItem key={p.id} active={p.id === groupBy?.id} icon={<PropertyTypeIcon type={p.type} />} onClick={() => onSet({ groupBy: p.id })}>
          {p.name}
        </MenuItem>
      ))}
      <MenuSeparator />
      <button
        type="button"
        role="switch"
        aria-checked={showTable}
        onClick={() => onSet({ showTable: !showTable })}
        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-bg-hover"
      >
        <span className="flex-1">{t("showTable")}</span>
        <span
          aria-hidden
          className={cn(
            "relative h-4 w-7 rounded-full transition-colors",
            showTable ? "bg-accent" : "bg-bg-active",
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 h-3 w-3 rounded-full bg-bg shadow transition-[left]",
              showTable ? "left-3.5" : "left-0.5",
            )}
          />
        </span>
      </button>
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

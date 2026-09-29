"use client";

import { Lock } from "lucide-react";
import { useTranslations } from "next-intl";
import { createContext, useContext, useMemo } from "react";
import { cn } from "@/components/ui";
import { atLeast, type PropertyAccessInfo, type PropertyLevel } from "@/lib/property-access";

/**
 * What the viewer may do with each property of the database being shown (see
 * lib/property-access). Properties missing from `info` aren't restricted for them.
 */
export type PropertyAccessContextValue = {
  /** The viewer's level on each restricted property (the most any row gives them). */
  info: Record<string, PropertyAccessInfo>;
  /** Full access: the properties that have access rules (the rules don't apply to them). */
  restricted: readonly string[];
  /** Full access to the database: may change who can see and edit each property. */
  canManage: boolean;
  /** Loads the database again after its access changed here. */
  refresh?: () => void;
};

const EMPTY: PropertyAccessContextValue = { info: {}, restricted: [], canManage: false };

const PropertyAccessContext = createContext<PropertyAccessContextValue>(EMPTY);

export const PropertyAccessProvider = PropertyAccessContext.Provider;

/** A row as far as property access goes: which values were left out, and which can't change here. */
type RowAccess = { hidden?: string[]; readOnly?: string[] };

export type ValueAccess = "hidden" | "readOnly" | "edit";

export function usePropertyAccess() {
  const value = useContext(PropertyAccessContext);
  return useMemo(() => {
    const restricted = new Set(value.restricted);
    const levelOf = (id: string): PropertyLevel => value.info[id]?.level ?? "edit";
    return {
      canManage: value.canManage,
      refresh: value.refresh,
      levelOf,
      infoOf: (id: string): PropertyAccessInfo | undefined => value.info[id],
      /** Has rules: restricted for the viewer, or (with full access) for others. */
      isRestricted: (id: string) => id in value.info || restricted.has(id),
      /** Rename, change the type or options, delete. */
      canEditSchema: (id: string) => atLeast(levelOf(id), "edit"),
      /** Change values in at least some rows (see `valueAccess` for one row). */
      canEditValues: (id: string) => atLeast(levelOf(id), "edit_values"),
      /** A value of this row: left out, shown read-only, or editable. */
      valueAccess: (row: RowAccess | null | undefined, id: string): ValueAccess => {
        if (row?.hidden?.includes(id)) return "hidden";
        if (row?.readOnly?.includes(id) || !atLeast(levelOf(id), "edit_values")) return "readOnly";
        return "edit";
      },
    };
  }, [value]);
}

export type PropertyAccessHelpers = ReturnType<typeof usePropertyAccess>;

/** Stands in for a value the viewer may not see: a muted lock, nothing to click. */
export function HiddenValue({ className }: { className?: string }) {
  const t = useTranslations("database.propertyAccess");
  return (
    <span
      className={cn("inline-flex min-w-0 items-center gap-1 text-fg-faint", className)}
      title={t("hiddenValue")}
      aria-label={t("hiddenValue")}
      role="img"
    >
      <Lock className="h-3 w-3 shrink-0" aria-hidden />
    </span>
  );
}

/**
 * The lock next to a restricted property's name, with what the viewer may do as its tooltip.
 * Renders nothing for properties without rules.
 */
export function PropertyLock({ propertyId, className }: { propertyId: string; className?: string }) {
  const t = useTranslations("database.propertyAccess");
  const access = usePropertyAccess();
  if (!access.isRestricted(propertyId)) return null;
  const info = access.infoOf(propertyId);
  const label = !info
    ? t("lock.full")
    : info.perRow
      ? `${t(`lock.${info.level}`)} ${t("lock.perRow")}`
      : t(`lock.${info.level}`);
  return (
    <span title={label} aria-label={label} role="img" className={cn("inline-flex shrink-0 text-fg-faint", className)}>
      <Lock className="h-3 w-3" aria-hidden />
    </span>
  );
}

import {
  AlignLeft,
  ArrowUpRight,
  Calendar,
  CalendarDays,
  CircleChevronDown,
  Hash,
  Kanban,
  Link as LinkIcon,
  List,
  Sheet,
  SquareCheck,
  Type,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import type { ViewType } from "@/db/schema/app";
import type { PropertyType } from "./types";

/** `label` is a message key under `database.types`. */
export const PROPERTY_TYPE_META = {
  text: { label: "text", icon: AlignLeft },
  number: { label: "number", icon: Hash },
  select: { label: "select", icon: CircleChevronDown },
  multi_select: { label: "multiSelect", icon: List },
  date: { label: "date", icon: Calendar },
  checkbox: { label: "checkbox", icon: SquareCheck },
  url: { label: "url", icon: LinkIcon },
  relation: { label: "relation", icon: ArrowUpRight },
} as const satisfies Record<PropertyType, { label: string; icon: LucideIcon }>;

/** Translated display name of a property type. */
export function usePropertyTypeLabel() {
  const t = useTranslations("database.types");
  return (type: PropertyType) => t(PROPERTY_TYPE_META[type].label);
}

const VIEW_ICONS = { table: Sheet, board: Kanban, calendar: CalendarDays } as const satisfies Record<ViewType, LucideIcon>;

export function ViewIcon({ type, className }: { type: ViewType; className?: string }) {
  const Icon = VIEW_ICONS[type] ?? Sheet;
  return <Icon className={className ?? "h-3.5 w-3.5"} strokeWidth={1.75} aria-hidden />;
}

export function PropertyTypeIcon({ type, className }: { type: PropertyType | "title"; className?: string }) {
  const Icon = type === "title" ? Type : PROPERTY_TYPE_META[type].icon;
  return <Icon className={className ?? "h-3.5 w-3.5"} strokeWidth={1.75} aria-hidden />;
}

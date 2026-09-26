import {
  AlignLeft,
  Calendar,
  CircleChevronDown,
  Hash,
  Link as LinkIcon,
  List,
  SquareCheck,
  Type,
  type LucideIcon,
} from "lucide-react";
import type { PropertyType } from "./types";

export const PROPERTY_TYPE_META: Record<PropertyType, { label: string; icon: LucideIcon }> = {
  text: { label: "Text", icon: AlignLeft },
  number: { label: "Number", icon: Hash },
  select: { label: "Select", icon: CircleChevronDown },
  multi_select: { label: "Multi-select", icon: List },
  date: { label: "Date", icon: Calendar },
  checkbox: { label: "Checkbox", icon: SquareCheck },
  url: { label: "URL", icon: LinkIcon },
};

export function PropertyTypeIcon({ type, className }: { type: PropertyType | "title"; className?: string }) {
  const Icon = type === "title" ? Type : PROPERTY_TYPE_META[type].icon;
  return <Icon className={className ?? "h-3.5 w-3.5"} strokeWidth={1.75} aria-hidden />;
}

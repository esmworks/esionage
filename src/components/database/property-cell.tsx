"use client";

import { Check, ExternalLink, Plus, X } from "lucide-react";
import Link from "next/link";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "@/components/ui";
import { Floating } from "./floating";
import { PersonChips, PersonPicker } from "./person-cell";
import { RelationChips, RelationPicker } from "./relation-cell";
import type { Property, SelectOption } from "./types";

export type CreateOption = (propertyId: string, name: string) => Promise<SelectOption | null>;

export function OptionChip({
  option,
  onRemove,
  className,
}: {
  option: SelectOption;
  onRemove?: () => void;
  className?: string;
}) {
  const t = useTranslations("database.cell");
  const tc = useTranslations("common");
  return (
    <span
      className={cn(
        `opt-${option.color} inline-flex max-w-full min-w-0 items-center gap-0.5 rounded px-1.5 text-xs leading-5`,
        className,
      )}
    >
      <span className="truncate">{option.name || tc("untitled")}</span>
      {onRemove && (
        <button
          type="button"
          aria-label={t("removeOption", { name: option.name })}
          className="-mr-0.5 rounded opacity-60 hover:opacity-100"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  );
}

function optionsOf(prop: Property) {
  return prop.options.options ?? [];
}

function selectedOptions(prop: Property, value: unknown): SelectOption[] {
  const ids = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  const options = optionsOf(prop);
  return ids.map((id) => options.find((o) => o.id === id)).filter((o): o is SelectOption => Boolean(o));
}

/**
 * Formats stored date values (`YYYY-MM-DD`) in the UI locale. Dates are calendar days, so they are
 * read and printed in UTC; the viewer's time zone must not shift them by a day.
 */
export function useFormatDate() {
  const format = useFormatter();
  return (value: string) => {
    const d = new Date(`${value.slice(0, 10)}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}/.test(value) || Number.isNaN(d.getTime())) return value;
    return format.dateTime(d, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
  };
}

/** Formats a number value in the UI locale (grouping and decimal separator). */
export function useFormatNumber() {
  const format = useFormatter();
  return (value: number) => format.number(value, { maximumFractionDigits: 10 });
}

export function isEmptyValue(prop: Property, value: unknown) {
  if (value === null || value === undefined || value === "") return true;
  if (prop.type === "relation" || prop.type === "person") return !Array.isArray(value) || value.length === 0;
  if (Array.isArray(value)) return selectedOptions(prop, value).length === 0;
  if (prop.type === "select") return selectedOptions(prop, value).length === 0;
  if (prop.type === "checkbox") return value !== true;
  return false;
}

/** Read-only rendering of a property value (board cards, read-only panels). */
export function PropertyDisplay({ prop, value, wrap }: { prop: Property; value: unknown; wrap?: boolean }) {
  const formatDate = useFormatDate();
  const formatNumber = useFormatNumber();
  if (value === null || value === undefined || value === "") return null;
  switch (prop.type) {
    case "text":
      return <span className={cn(wrap ? "whitespace-pre-wrap break-words" : "truncate")}>{String(value)}</span>;
    case "number":
      return <span className="tabular-nums">{typeof value === "number" ? formatNumber(value) : String(value)}</span>;
    case "url":
      return (
        <a
          href={String(value)}
          target="_blank"
          rel="noreferrer noopener"
          className="truncate text-fg underline decoration-border underline-offset-2 hover:decoration-fg-muted"
          onClick={(e) => e.stopPropagation()}
        >
          {String(value).replace(/^https?:\/\//i, "")}
        </a>
      );
    case "date":
      return <span>{formatDate(String(value))}</span>;
    case "checkbox":
      return <CheckboxBox checked={value === true} />;
    case "relation":
      return <RelationChips prop={prop} value={value} wrap={wrap} />;
    case "person":
      return <PersonChips value={value} wrap={wrap} />;
    case "select":
    case "multi_select": {
      const selected = selectedOptions(prop, value);
      if (!selected.length) return null;
      return (
        <span className={cn("flex min-w-0 gap-1", wrap ? "flex-wrap" : "overflow-hidden")}>
          {selected.map((o) => (
            <OptionChip key={o.id} option={o} />
          ))}
        </span>
      );
    }
  }
}

function CheckboxBox({ checked }: { checked: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] border",
        checked ? "border-accent bg-accent text-accent-fg" : "border-fg-faint bg-bg",
      )}
    >
      {checked && <Check className="h-3 w-3" strokeWidth={3} />}
    </span>
  );
}

/**
 * Editable property value. Text-like values edit in a floating editor that covers the cell;
 * selects open an option picker; checkboxes toggle in place. Drafts are local, so refetches
 * never overwrite what the user is typing.
 */
export function PropertyCell({
  prop,
  value,
  onChange,
  onCreateOption,
  readOnly,
  variant = "table",
  wrap,
  autoEdit,
  placeholder,
}: {
  prop: Property;
  value: unknown;
  onChange: (value: unknown) => void;
  onCreateOption: CreateOption;
  readOnly?: boolean;
  variant?: "table" | "panel";
  wrap?: boolean;
  /** Start in edit mode (e.g. the title of a freshly created row). */
  autoEdit?: boolean;
  placeholder?: string;
}) {
  const t = useTranslations("database.cell");
  const [anchor, setAnchor] = useState<HTMLDivElement | null>(null);
  const [editing, setEditing] = useState(Boolean(autoEdit) && !readOnly);

  const base = cn(
    "flex w-full min-w-0 items-center text-sm",
    variant === "table" ? "min-h-[33px] px-2 py-1" : "min-h-[30px] rounded-md px-2 py-1",
    !readOnly && "cursor-pointer",
    !readOnly && variant === "panel" && "hover:bg-bg-hover",
  );

  if (prop.type === "checkbox") {
    return (
      <div className={cn(base, "cursor-default")}>
        <button
          type="button"
          role="checkbox"
          aria-checked={value === true}
          aria-label={prop.name}
          disabled={readOnly}
          className="inline-flex disabled:cursor-default"
          onClick={() => onChange(!(value === true))}
        >
          <CheckboxBox checked={value === true} />
        </button>
      </div>
    );
  }

  const empty = isEmptyValue(prop, value);
  return (
    <>
      <div
        ref={setAnchor}
        className={base}
        role={readOnly ? undefined : "button"}
        tabIndex={readOnly ? undefined : 0}
        onClick={() => !readOnly && setEditing(true)}
        onKeyDown={(e) => {
          if (!readOnly && (e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
            e.preventDefault();
            setEditing(true);
          }
        }}
      >
        {empty ? (
          (placeholder ?? (variant === "panel" ? t("empty") : null)) && (
            <span className="truncate text-fg-faint">{placeholder ?? t("empty")}</span>
          )
        ) : (
          <PropertyDisplay prop={prop} value={value} wrap={wrap} />
        )}
      </div>
      {editing && (
        <CellEditor
          prop={prop}
          value={value}
          anchor={anchor}
          onChange={onChange}
          onCreateOption={onCreateOption}
          onClose={() => setEditing(false)}
        />
      )}
    </>
  );
}

function CellEditor({
  prop,
  value,
  anchor,
  onChange,
  onCreateOption,
  onClose,
}: {
  prop: Property;
  value: unknown;
  anchor: HTMLElement | null;
  onChange: (value: unknown) => void;
  onCreateOption: CreateOption;
  onClose: () => void;
}) {
  switch (prop.type) {
    case "text":
    case "number":
    case "url":
      return <TextEditor prop={prop} value={value} anchor={anchor} onChange={onChange} onClose={onClose} />;
    case "date":
      return <DateEditor value={value} anchor={anchor} onChange={onChange} onClose={onClose} />;
    case "select":
    case "multi_select":
      return (
        <Floating open anchor={anchor} onClose={onClose} className="w-72 p-0">
          <OptionPicker
            prop={prop}
            value={value}
            onChange={onChange}
            onCreateOption={onCreateOption}
            onDone={onClose}
          />
        </Floating>
      );
    case "relation":
      return (
        <Floating open anchor={anchor} onClose={onClose} className="w-auto p-0">
          <RelationPicker prop={prop} value={value} onChange={onChange} />
        </Floating>
      );
    case "person":
      return (
        <Floating open anchor={anchor} onClose={onClose} className="w-auto p-0">
          <PersonPicker prop={prop} value={value} onChange={onChange} />
        </Floating>
      );
    default:
      return null;
  }
}

/**
 * Parses a typed number in either "1234.5" or "1234,5" style, so it works for English and Turkish
 * input alike. A single separator kind is a decimal point unless it repeats ("1.234.567"); with
 * both kinds, the last one is the decimal point and the other groups thousands ("1.234,5",
 * "1,234.5").
 */
export function parseNumber(raw: string, locale?: string): number | undefined {
  let s = raw.replace(/[\s\u00a0\u202f']/g, "");
  if (!s) return undefined;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma !== -1 && lastDot !== -1) {
    const decimal = lastComma > lastDot ? "," : ".";
    const group = decimal === "," ? "." : ",";
    s = s.split(group).join("").replace(decimal, ".");
  } else {
    const sep = lastComma !== -1 ? "," : lastDot !== -1 ? "." : null;
    // "1,000" in English or "1.000" in Turkish: the locale's group separator before exactly three
    // digits groups thousands rather than marking decimals.
    const grouping = sep !== null && locale !== undefined && sep !== decimalSeparator(locale) && /^-?\d{1,3}[.,]\d{3}$/.test(s);
    if (sep) s = s.split(sep).length > 2 || grouping ? s.split(sep).join("") : s.replace(sep, ".");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

function decimalSeparator(locale: string) {
  return new Intl.NumberFormat(locale).formatToParts(1.5).find((p) => p.type === "decimal")?.value ?? ".";
}

/** Parses editor input into a storable value; returns undefined when it is invalid. */
export function parseInput(prop: Property, raw: string, locale?: string): unknown {
  const s = raw.trim();
  if (!s) return null;
  if (prop.type === "number") return parseNumber(s, locale);
  if (prop.type === "url") {
    if (/^(https?:\/\/|mailto:)/i.test(s)) return s;
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return `mailto:${s}`;
    if (/^[^\s]+\.[^\s]+$/.test(s)) return `https://${s}`;
    return undefined;
  }
  return raw;
}

/**
 * Initial editor text for a stored value. Numbers use the locale's decimal separator (no
 * grouping), so what the user sees is what `parseNumber` reads back.
 */
function editText(value: unknown, locale: string) {
  if (value === null || value === undefined) return "";
  if (typeof value !== "number") return String(value);
  const decimal = decimalSeparator(locale);
  const s = String(value);
  return decimal === "," && !s.includes("e") ? s.replace(".", ",") : s;
}

function TextEditor({
  prop,
  value,
  anchor,
  onChange,
  onClose,
}: {
  prop: Property;
  value: unknown;
  anchor: HTMLElement | null;
  onChange: (value: unknown) => void;
  onClose: () => void;
}) {
  const t = useTranslations("database.cell");
  const locale = useLocale();
  const initial = editText(value, locale);
  const [draft, setDraft] = useState(initial);
  const [invalid, setInvalid] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);

  const commit = () => {
    if (draft !== initial) {
      const parsed = parseInput(prop, draft, locale);
      // A second close attempt with an invalid draft discards it instead of trapping the user.
      if (parsed === undefined && !invalid) {
        setInvalid(true);
        input.current?.focus();
        return false;
      }
      if (parsed !== undefined) onChange(parsed);
    }
    onClose();
    return true;
  };

  return (
    <Floating open cover anchor={anchor} onClose={commit} className="w-auto max-w-md p-0">
      <textarea
        ref={input}
        rows={1}
        value={draft}
        inputMode={prop.type === "number" ? "decimal" : undefined}
        aria-label={prop.name}
        onChange={(e) => {
          setDraft(prop.type === "text" ? e.target.value : e.target.value.replace(/\n/g, ""));
          setInvalid(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            commit();
          }
        }}
        className={cn(
          "block w-full min-w-[240px] resize-none bg-transparent px-2 py-1.5 text-sm leading-5 outline-none",
          prop.type === "number" && "tabular-nums",
        )}
      />
      {invalid && (
        <div className="border-t border-border px-2 py-1 text-xs text-danger">
          {prop.type === "number" ? t("enterNumber") : t("enterUrl")}
        </div>
      )}
    </Floating>
  );
}

function DateEditor({
  value,
  anchor,
  onChange,
  onClose,
}: {
  value: unknown;
  anchor: HTMLElement | null;
  onChange: (value: unknown) => void;
  onClose: () => void;
}) {
  const t = useTranslations("database.cell");
  const [draft, setDraft] = useState(typeof value === "string" ? value : "");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  return (
    <Floating open anchor={anchor} onClose={onClose} className="w-64 p-2">
      <input
        ref={input}
        type="date"
        value={draft}
        aria-label={t("date")}
        onChange={(e) => {
          setDraft(e.target.value);
          // An emptied field clears the date, like the Clear button.
          onChange(e.target.value || null);
        }}
        onKeyDown={(e) => e.key === "Enter" && onClose()}
        className="h-8 w-full rounded-md border border-border bg-bg px-2 text-sm outline-none [color-scheme:light_dark] focus:border-accent"
      />
      <div className="mt-2 flex justify-between gap-2">
        <button
          type="button"
          className="rounded-md px-2 py-1 text-xs text-fg-muted hover:bg-bg-hover hover:text-fg"
          onClick={() => {
            const today = new Date();
            const iso = new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
            setDraft(iso);
            onChange(iso);
          }}
        >
          {t("today")}
        </button>
        <button
          type="button"
          className="rounded-md px-2 py-1 text-xs text-fg-muted hover:bg-bg-hover hover:text-fg"
          onClick={() => {
            onChange(null);
            onClose();
          }}
        >
          {t("clear")}
        </button>
      </div>
    </Floating>
  );
}

/** Search/select/create options for select and multi-select values. */
export function OptionPicker({
  prop,
  value,
  onChange,
  onCreateOption,
  onDone,
}: {
  prop: Property;
  value: unknown;
  onChange: (value: unknown) => void;
  onCreateOption: CreateOption;
  onDone: () => void;
}) {
  const t = useTranslations("database.cell");
  const multi = prop.type === "multi_select";
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  // Local selection so rapid multi-select toggles don't race the optimistic parent state.
  // Ids of deleted options are dropped: sending them back would make the server reject the edit.
  const [selectedIds, setSelectedIds] = useState<string[]>(() =>
    (Array.isArray(value) ? (value as string[]) : typeof value === "string" ? [value] : []).filter((id) =>
      optionsOf(prop).some((o) => o.id === id),
    ),
  );
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);

  const options = optionsOf(prop);
  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => options.filter((o) => o.name.toLowerCase().includes(q)), [options, q]);
  const exact = options.some((o) => o.name.toLowerCase() === q);
  const canCreate = q.length > 0 && !exact;
  const items: ({ kind: "option"; option: SelectOption } | { kind: "create" })[] = [
    ...filtered.map((option) => ({ kind: "option" as const, option })),
    ...(canCreate ? [{ kind: "create" as const }] : []),
  ];

  const selected = selectedIds
    .map((id) => options.find((o) => o.id === id))
    .filter((o): o is SelectOption => Boolean(o));

  const setIds = (ids: string[]) => {
    setSelectedIds(ids);
    onChange(multi ? (ids.length ? ids : null) : (ids[0] ?? null));
  };

  const pick = (option: SelectOption) => {
    if (multi) {
      setIds(selectedIds.includes(option.id) ? selectedIds.filter((id) => id !== option.id) : [...selectedIds, option.id]);
      setQuery("");
    } else {
      setIds([option.id]);
      onDone();
    }
  };

  const create = async () => {
    const name = query.trim();
    if (!name || busy) return;
    setBusy(true);
    const option = await onCreateOption(prop.id, name);
    setBusy(false);
    if (!option) return;
    setQuery("");
    if (multi) setIds([...selectedIds.filter((id) => id !== option.id), option.id]);
    else {
      setIds([option.id]);
      onDone();
    }
  };

  const choose = (i: number) => {
    const item = items[i];
    if (!item) return;
    if (item.kind === "create") void create();
    else pick(item.option);
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1 border-b border-border bg-bg-subtle px-2 py-1.5">
        {selected.map((o) => (
          <OptionChip key={o.id} option={o} onRemove={() => setIds(selectedIds.filter((id) => id !== o.id))} />
        ))}
        <input
          ref={input}
          value={query}
          placeholder={selected.length ? "" : t("searchOrCreate")}
          aria-label={t("optionInput", { property: prop.name })}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, items.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              choose(active);
            } else if (e.key === "Backspace" && !query && selectedIds.length) {
              setIds(selectedIds.slice(0, -1));
            }
          }}
          className="h-6 min-w-24 flex-1 bg-transparent text-sm outline-none placeholder:text-fg-faint"
        />
      </div>
      <div className="max-h-64 overflow-y-auto p-1">
        {!items.length && <div className="px-2 py-1.5 text-xs text-fg-faint">{t("typeToCreate")}</div>}
        {items.length > 0 && (
          <div className="px-2 pt-1 pb-1.5 text-xs text-fg-muted">
            {multi ? t("selectOptions") : t("selectOption")}
          </div>
        )}
        {items.map((item, i) => (
          <button
            key={item.kind === "create" ? "__create" : item.option.id}
            type="button"
            onMouseEnter={() => setActive(i)}
            onClick={() => choose(i)}
            className={cn(
              "flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm",
              i === active && "bg-bg-hover",
            )}
          >
            {item.kind === "create" ? (
              <>
                <Plus className="h-3.5 w-3.5 text-fg-muted" />
                <span className="text-fg-muted">{t("create")}</span>
                <OptionChip option={{ id: "new", name: query.trim(), color: "gray" }} />
              </>
            ) : (
              <>
                <OptionChip option={item.option} />
                <span className="flex-1" />
                {selectedIds.includes(item.option.id) && <Check className="h-3.5 w-3.5 text-fg-muted" />}
              </>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Small labelled icon link used for "Open" affordances. */
export function OpenLink({ href, children }: { href: string; children?: ReactNode }) {
  const t = useTranslations("database.rowMenu");
  return (
    <Link
      href={href}
      className="inline-flex h-6 items-center gap-1 rounded-md border border-border bg-bg px-1.5 text-xs text-fg-muted shadow-sm hover:bg-bg-hover hover:text-fg"
      onClick={(e) => e.stopPropagation()}
    >
      <ExternalLink className="h-3 w-3" />
      {children ?? t("open")}
    </Link>
  );
}

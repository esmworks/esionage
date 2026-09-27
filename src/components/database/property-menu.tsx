"use client";

import { ArrowDown, ArrowLeft, ArrowUp, EyeOff, Plus, Settings2, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Button, cn, Input, MenuItem, MenuSeparator } from "@/components/ui";
import { PROPERTY_TYPES } from "@/lib/property-types";
import { pageLabel } from "@/lib/labels";
import { SELECT_COLORS } from "@/lib/properties";
import { OptionChip } from "./property-cell";
import { PropertyTypeIcon, usePropertyTypeLabel } from "./property-icons";
import { RelationSetup } from "./relation-cell";
import { useRelations } from "./relation-context";
import type { Property, PropertyType, RelationInput, SelectOption } from "./types";

/** Name + type picker used by the table "+" header and the row page "Add property". */
export function AddPropertyPanel({
  onCreate,
  onDone,
}: {
  onCreate: (name: string, type: PropertyType, relation?: RelationInput) => void | Promise<unknown>;
  onDone: () => void;
}) {
  const t = useTranslations("database.propertyMenu");
  const typeLabel = usePropertyTypeLabel();
  const [name, setName] = useState("");
  const [step, setStep] = useState<"type" | "relation">("type");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  // A new property without a name is named after its type, in the user's language.
  const nameFor = (type: PropertyType) => name.trim() || typeLabel(type);
  const create = (type: PropertyType) => {
    if (type === "relation") {
      setStep("relation");
      return;
    }
    void onCreate(nameFor(type), type);
    onDone();
  };
  if (step === "relation") {
    return (
      <RelationSetup
        name={nameFor("relation")}
        onBack={() => setStep("type")}
        onCreate={(relation) => {
          void onCreate(nameFor("relation"), "relation", relation);
          onDone();
        }}
      />
    );
  }
  return (
    <div className="w-60">
      <div className="p-1">
        <Input
          ref={input}
          value={name}
          placeholder={t("name")}
          aria-label={t("name")}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && create("text")}
          className="h-7"
        />
      </div>
      <div className="px-2 pt-1.5 pb-1 text-xs text-fg-muted">{t("type")}</div>
      {PROPERTY_TYPES.map((type) => (
        <MenuItem key={type} icon={<PropertyTypeIcon type={type} />} onClick={() => create(type)}>
          {typeLabel(type)}
        </MenuItem>
      ))}
    </div>
  );
}

export type PropertyMenuActions = {
  /** Omitted when the name can't change (Name column, locked database). */
  rename?: (name: string) => void;
  /** Omitted for properties that can't be sorted (relations). */
  sort?: (direction: "asc" | "desc") => void;
  hide?: () => void;
  setOptions?: (options: SelectOption[]) => void;
  remove?: () => void;
};

/** Header menu for a property (or the Name column, which only supports sorting). */
export function PropertyMenu({
  prop,
  actions,
  onDone,
}: {
  prop: Property | null;
  actions: PropertyMenuActions;
  onDone: () => void;
}) {
  const t = useTranslations("database.propertyMenu");
  const tc = useTranslations("common");
  const typeLabel = usePropertyTypeLabel();
  const [page, setPage] = useState<"main" | "options" | "confirm">("main");
  const [name, setName] = useState(prop?.name ?? "");
  const saved = useRef(prop?.name ?? "");
  const commitName = () => {
    const next = name.trim();
    if (prop && actions.rename && next && next !== saved.current) {
      saved.current = next;
      actions.rename(next);
    }
  };
  // Closing the menu by clicking outside unmounts it before the input's blur fires.
  const commitRef = useRef(commitName);
  commitRef.current = commitName;
  useEffect(() => () => commitRef.current(), []);

  if (page === "options" && prop && actions.setOptions) {
    return <OptionsEditor prop={prop} onChange={actions.setOptions} onBack={() => setPage("main")} />;
  }

  if (page === "confirm" && prop && actions.remove) {
    return (
      <div className="w-64 p-2">
        <p className="text-sm font-medium">{t("confirmDelete", { name: prop.name })}</p>
        <p className="mt-1 text-xs text-fg-muted">{t("confirmDeleteBody")}</p>
        <div className="mt-3 flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => setPage("main")}>
            {tc("cancel")}
          </Button>
          <Button
            size="sm"
            variant="danger"
            onClick={() => {
              actions.remove?.();
              onDone();
            }}
          >
            {tc("delete")}
          </Button>
        </div>
      </div>
    );
  }

  const selectType = prop?.type === "select" || prop?.type === "multi_select";
  return (
    <div className="w-60">
      {prop && (
        <>
          <div className="p-1">
            <Input
              value={name}
              aria-label={t("name")}
              readOnly={!actions.rename}
              autoFocus={Boolean(actions.rename)}
              onChange={(e) => setName(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  commitName();
                  onDone();
                }
              }}
              className="h-7"
            />
          </div>
          <div className="flex items-center gap-2 px-2 py-1 text-xs text-fg-muted">
            <PropertyTypeIcon type={prop.type} />
            {typeLabel(prop.type)}
          </div>
          {prop.type === "relation" && <RelationInfo prop={prop} />}
          <MenuSeparator />
        </>
      )}
      {actions.sort && (
        <>
          <MenuItem
            icon={<ArrowUp className="h-3.5 w-3.5" />}
            onClick={() => {
              actions.sort?.("asc");
              onDone();
            }}
          >
            {t("sortAscending")}
          </MenuItem>
          <MenuItem
            icon={<ArrowDown className="h-3.5 w-3.5" />}
            onClick={() => {
              actions.sort?.("desc");
              onDone();
            }}
          >
            {t("sortDescending")}
          </MenuItem>
        </>
      )}
      {actions.hide && (
        <MenuItem
          icon={<EyeOff className="h-3.5 w-3.5" />}
          onClick={() => {
            actions.hide?.();
            onDone();
          }}
        >
          {t("hide")}
        </MenuItem>
      )}
      {selectType && actions.setOptions && (
        <MenuItem icon={<Settings2 className="h-3.5 w-3.5" />} onClick={() => setPage("options")}>
          {t("editOptions")}
        </MenuItem>
      )}
      {prop && actions.remove && (
        <>
          <MenuSeparator />
          <MenuItem danger icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setPage("confirm")}>
            {t("delete")}
          </MenuItem>
        </>
      )}
    </div>
  );
}

function OptionsEditor({
  prop,
  onChange,
  onBack,
}: {
  prop: Property;
  onChange: (options: SelectOption[]) => void;
  onBack: () => void;
}) {
  const t = useTranslations("database.propertyMenu");
  const tColor = useTranslations("database.colors");
  // Edited locally and saved per change; the parent applies it optimistically.
  const [options, setOptions] = useState<SelectOption[]>(prop.options.options ?? []);
  const [editing, setEditing] = useState<string | null>(null);
  const [newName, setNewName] = useState("");

  const save = (next: SelectOption[]) => {
    setOptions(next);
    onChange(next);
  };

  const add = () => {
    const name = newName.trim();
    if (!name) return;
    if (options.some((o) => o.name.toLowerCase() === name.toLowerCase())) {
      setNewName("");
      return;
    }
    save([...options, { id: crypto.randomUUID(), name, color: SELECT_COLORS[options.length % SELECT_COLORS.length] }]);
    setNewName("");
  };

  return (
    <div className="w-72">
      <div className="flex items-center gap-1 px-1 pb-1">
        <button
          type="button"
          aria-label={t("back")}
          onClick={onBack}
          className="inline-flex h-6 w-6 items-center justify-center rounded text-fg-muted hover:bg-bg-hover hover:text-fg"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </button>
        <span className="text-sm font-medium">{t("optionsTitle", { name: prop.name })}</span>
      </div>
      <MenuSeparator />
      <div className="max-h-80 overflow-y-auto">
        {!options.length && <div className="px-2 py-2 text-xs text-fg-faint">{t("noOptions")}</div>}
        {options.map((o) => (
          <div key={o.id} className="rounded px-1 py-0.5 hover:bg-bg-subtle">
            <div className="flex items-center gap-1">
              {editing === o.id ? (
                <Input
                  autoFocus
                  defaultValue={o.name}
                  aria-label={t("optionName")}
                  className="h-6 flex-1"
                  onBlur={(e) => {
                    const name = e.target.value.trim();
                    if (name && name !== o.name) save(options.map((x) => (x.id === o.id ? { ...x, name } : x)));
                    setEditing(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => setEditing(o.id)}
                  title={t("renameOption")}
                >
                  <OptionChip option={o} />
                </button>
              )}
              <button
                type="button"
                aria-label={t("deleteOptionNamed", { name: o.name })}
                title={t("deleteOption")}
                onClick={() => save(options.filter((x) => x.id !== o.id))}
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-fg-muted hover:bg-bg-hover hover:text-danger"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="mt-1 mb-0.5 flex gap-1">
              {SELECT_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  aria-label={t("color", { color: tColor(color) })}
                  title={tColor(color)}
                  onClick={() => color !== o.color && save(options.map((x) => (x.id === o.id ? { ...x, color } : x)))}
                  className={cn(
                    `opt-${color} h-4 w-4 rounded`,
                    color === o.color ? "ring-2 ring-accent ring-offset-1 ring-offset-bg" : "hover:ring-1 hover:ring-border",
                  )}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
      <MenuSeparator />
      <div className="flex items-center gap-1 p-1">
        <Input
          value={newName}
          placeholder={t("addOptionPlaceholder")}
          aria-label={t("newOption")}
          className="h-7"
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <button
          type="button"
          aria-label={t("addOption")}
          onClick={add}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-bg-hover hover:text-fg"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

/** Which database a relation points to, and whether it is mirrored there. */
function RelationInfo({ prop }: { prop: Property }) {
  const t = useTranslations("database.relation");
  const tc = useTranslations("common");
  const target = useRelations()?.targets[prop.id];
  if (!target?.database) return <div className="px-2 pb-1 text-xs text-fg-faint">{t("missingDatabase")}</div>;
  return (
    <div className="px-2 pb-1 text-xs text-fg-muted">
      <div className="truncate">{t("relatedTo", { title: pageLabel(target.database.title, tc("untitled")) })}</div>
      {target.pairedName && <div className="truncate">{t("pairedWith", { name: target.pairedName })}</div>}
    </div>
  );
}

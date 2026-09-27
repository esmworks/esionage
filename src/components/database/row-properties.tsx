"use client";

import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addPropertyAction,
  createRowAction,
  ensureOptionAction,
  loadRowAction,
  updateRowPropertiesAction,
} from "@/app/actions/databases";
import { useChannel, useChannels } from "@/components/collab/use-channel";
import { withFormulas } from "@/lib/derived";
import type { PropertyType, SelectOption } from "@/db/schema/app";
import { Floating, useFloating } from "./floating";
import { PeopleProvider, type PeopleContextValue } from "./person-cell";
import { PropertyCell } from "./property-cell";
import { PropertyTypeIcon } from "./property-icons";
import { AddPropertyPanel } from "./property-menu";
import { RelationProvider, type RelationContextValue } from "./relation-context";
import { SchemaProvider } from "./schema-context";
import type { DerivedInput, PersonRef, Property, RelationInput, RelationTarget } from "./types";

type Loaded = {
  databaseTitle: string;
  /** The row's title, which formulas can read. */
  title: string;
  /** The database's schema is locked: no new properties from here. */
  locked: boolean;
  properties: Property[];
  values: Record<string, unknown>;
  relations: Record<string, RelationTarget>;
  people: PersonRef[];
  viewerId: string;
};

/** Editable property list shown above a database row's page body. */
export function RowProperties({
  workspaceId,
  databaseId,
  rowId,
  readOnly,
}: {
  workspaceId: string;
  databaseId: string;
  rowId: string;
  readOnly?: boolean;
}) {
  const t = useTranslations("database.rowProperties");
  const tc = useTranslations("common");
  // Actions throw (instead of returning an error) when the session expired or the network failed.
  const safe = useCallback(
    async <T,>(action: Promise<{ ok: true; data: T } | { ok: false; error: string }>) => {
      try {
        return await action;
      } catch {
        return { ok: false as const, error: tc("genericError") };
      }
    },
    [tc],
  );
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Values written locally but not yet confirmed by a refetch.
  const [pending, setPending] = useState<Record<string, { value: unknown; version: number }>>({});
  const seq = useRef(0);
  const version = useRef(0);

  const refetch = useCallback(async () => {
    const mine = ++seq.current;
    const res = await safe(loadRowAction(rowId));
    if (mine !== seq.current) return;
    if (res.ok) {
      setData({
        databaseTitle: res.data.databaseTitle,
        title: res.data.row.title,
        locked: res.data.databaseLocked,
        properties: res.data.properties,
        values: res.data.row.properties,
        relations: res.data.relations,
        people: res.data.people,
        viewerId: res.data.viewerId,
      });
    }
    else setError(res.error);
  }, [rowId, safe]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSignal = (event: string) => {
    if (event !== "rows" && event !== "schema") return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void refetch(), 60);
  };
  useChannel(`db:${databaseId}`, onSignal);
  // Related rows appear by title, so their databases' changes matter too.
  useChannels(
    Object.values(data?.relations ?? {}).flatMap((r) =>
      r.database && r.database.id !== databaseId ? [`db:${r.database.id}`] : [],
    ),
    onSignal,
  );
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const setValue = async (propertyId: string, value: unknown) => {
    const v = ++version.current;
    setPending((p) => ({ ...p, [propertyId]: { value, version: v } }));
    const res = await safe(updateRowPropertiesAction(rowId, { [propertyId]: value }));
    if (!res.ok) setError(res.error);
    else setError(null);
    await refetch();
    setPending((p) => {
      if (p[propertyId]?.version !== v) return p;
      const next = { ...p };
      delete next[propertyId];
      return next;
    });
  };

  const createOption = async (propertyId: string, name: string): Promise<SelectOption | null> => {
    const res = await safe(ensureOptionAction(propertyId, name));
    if (!res.ok) {
      setError(res.error);
      return null;
    }
    const option = res.data;
    setData((d) =>
      d && {
        ...d,
        properties: d.properties.map((p) =>
          p.id === propertyId && !(p.options.options ?? []).some((o) => o.id === option.id)
            ? { ...p, options: { ...p.options, options: [...(p.options.options ?? []), option] } }
            : p,
        ),
      },
    );
    return option;
  };

  const addProperty = async (name: string, type: PropertyType, relation?: RelationInput, derived?: DerivedInput) => {
    const res = await safe(addPropertyAction(databaseId, { name, type, relation, ...derived }));
    if (!res.ok) setError(res.error);
    await refetch();
  };

  const createRelatedRow = useCallback(
    async (targetDatabaseId: string, title: string) => {
      const res = await safe(createRowAction(workspaceId, targetDatabaseId, { title }));
      if (!res.ok) {
        setError(res.error);
        return null;
      }
      await refetch();
      return res.data.id;
    },
    [workspaceId, refetch, safe],
  );

  const relationContext = useMemo<RelationContextValue | null>(
    () =>
      data && {
        workspaceId,
        databaseId,
        databaseTitle: data.databaseTitle,
        targets: data.relations,
        createRow: createRelatedRow,
      },
    [data, workspaceId, databaseId, createRelatedRow],
  );
  const peopleContext = useMemo<PeopleContextValue>(
    () => ({ viewerId: data?.viewerId ?? null, people: data?.people ?? [] }),
    [data?.viewerId, data?.people],
  );

  // Edited values show right away, with the row's formulas worked out again from them.
  const values = useMemo(() => {
    if (!data) return {};
    const edited = Object.entries(pending);
    if (!edited.length) return data.values;
    const next = { ...data.values };
    for (const [id, p] of edited) next[id] = p.value;
    const [row] = withFormulas(data.properties, [{ title: data.title, properties: next }], {
      now: new Date(),
      people: data.people,
      relations: data.relations,
    });
    return row.properties;
  }, [data, pending]);

  if (!data) {
    return error ? (
      <p className="mb-4 text-sm text-danger">{error}</p>
    ) : (
      <div className="mb-6 h-16 animate-pulse rounded-md bg-bg-subtle" aria-busy="true" />
    );
  }

  const valueOf = (id: string) => values[id];

  return (
    <RelationProvider value={relationContext}>
      <PeopleProvider value={peopleContext}>
        <SchemaProvider value={data.properties}>
          <div className="mb-6 border-b border-border pb-4">
            <div className="flex flex-col gap-0.5">
              {data.properties.map((p) => (
                <div key={p.id} className="flex min-h-[30px] items-start gap-2">
                  <div className="flex h-[30px] w-28 shrink-0 items-center gap-1.5 px-1 text-sm text-fg-muted sm:w-40">
                    <PropertyTypeIcon type={p.type} className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate" title={p.name}>
                      {p.name}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <PropertyCell
                      variant="panel"
                      wrap
                      prop={p}
                      value={valueOf(p.id)}
                      readOnly={readOnly}
                      onChange={(v) => void setValue(p.id, v)}
                      onCreateOption={createOption}
                    />
                  </div>
                </div>
              ))}
            </div>
            {!data.properties.length && readOnly && <p className="px-1 text-sm text-fg-faint">{t("noProperties")}</p>}
            {!readOnly && !data.locked && <AddPropertyRow onCreate={addProperty} />}
            {error && <p className="mt-2 px-1 text-xs text-danger">{error}</p>}
          </div>
        </SchemaProvider>
      </PeopleProvider>
    </RelationProvider>
  );
}

function AddPropertyRow({
  onCreate,
}: {
  onCreate: (name: string, type: PropertyType, relation?: RelationInput, derived?: DerivedInput) => Promise<void>;
}) {
  const t = useTranslations("database.rowProperties");
  const menu = useFloating<HTMLButtonElement>();
  return (
    <>
      <button
        ref={menu.ref}
        type="button"
        onClick={menu.toggle}
        className="mt-1 inline-flex h-[30px] items-center gap-1.5 rounded-md px-1 text-sm text-fg-muted hover:bg-bg-hover hover:text-fg"
      >
        <Plus className="h-3.5 w-3.5" />
        {t("addProperty")}
      </button>
      <Floating open={menu.open} anchor={menu.el} onClose={menu.close}>
        <AddPropertyPanel onCreate={onCreate} onDone={menu.close} />
      </Floating>
    </>
  );
}

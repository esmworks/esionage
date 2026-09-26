"use client";

import { Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  addPropertyAction,
  ensureOptionAction,
  loadRowAction,
  updateRowPropertiesAction,
} from "@/app/actions/databases";
import { useChannel } from "@/components/collab/use-channel";
import type { PropertyType, SelectOption } from "@/db/schema/app";
import { Floating, useFloating } from "./floating";
import { PropertyCell } from "./property-cell";
import { PropertyTypeIcon } from "./property-icons";
import { AddPropertyPanel } from "./property-menu";
import type { Property } from "./types";

type Loaded = { properties: Property[]; values: Record<string, unknown> };

/** Editable property list shown above a database row's page body. */
export function RowProperties({
  databaseId,
  rowId,
  readOnly,
}: {
  workspaceId: string;
  databaseId: string;
  rowId: string;
  readOnly?: boolean;
}) {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Values written locally but not yet confirmed by a refetch.
  const [pending, setPending] = useState<Record<string, { value: unknown; version: number }>>({});
  const seq = useRef(0);
  const version = useRef(0);

  const refetch = useCallback(async () => {
    const mine = ++seq.current;
    const res = await loadRowAction(rowId);
    if (mine !== seq.current) return;
    if (res.ok) setData({ properties: res.data.properties, values: res.data.row.properties });
    else setError(res.error);
  }, [rowId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useChannel(`db:${databaseId}`, (event) => {
    if (event !== "rows" && event !== "schema") return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void refetch(), 60);
  });
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const setValue = async (propertyId: string, value: unknown) => {
    const v = ++version.current;
    setPending((p) => ({ ...p, [propertyId]: { value, version: v } }));
    const res = await updateRowPropertiesAction(rowId, { [propertyId]: value });
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
    const res = await ensureOptionAction(propertyId, name);
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

  const addProperty = async (name: string, type: PropertyType) => {
    const res = await addPropertyAction(databaseId, { name, type });
    if (!res.ok) setError(res.error);
    await refetch();
  };

  if (!data) {
    return error ? (
      <p className="mb-4 text-sm text-danger">{error}</p>
    ) : (
      <div className="mb-6 h-16 animate-pulse rounded-md bg-bg-subtle" aria-busy="true" />
    );
  }

  const valueOf = (id: string) => (id in pending ? pending[id].value : data.values[id]);

  return (
    <div className="mb-6 border-b border-border pb-4">
      <div className="flex flex-col gap-0.5">
        {data.properties.map((p) => (
          <div key={p.id} className="flex min-h-[30px] items-start gap-2">
            <div className="flex h-[30px] w-40 shrink-0 items-center gap-1.5 px-1 text-sm text-fg-muted">
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
      {!data.properties.length && readOnly && <p className="px-1 text-sm text-fg-faint">No properties</p>}
      {!readOnly && <AddPropertyRow onCreate={addProperty} />}
      {error && <p className="mt-2 px-1 text-xs text-danger">{error}</p>}
    </div>
  );
}

function AddPropertyRow({ onCreate }: { onCreate: (name: string, type: PropertyType) => Promise<void> }) {
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
        Add property
      </button>
      <Floating open={menu.open} anchor={menu.el} onClose={menu.close}>
        <AddPropertyPanel onCreate={onCreate} onDone={menu.close} />
      </Floating>
    </>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addPropertyAction,
  addViewAction,
  createRowAction,
  deletePropertyAction,
  deleteViewAction,
  ensureOptionAction,
  loadDatabaseAction,
  moveRowAction,
  updatePropertyAction,
  updateRowPropertiesAction,
  updateViewAction,
  type ActionResult,
} from "@/app/actions/databases";
import { archivePageAction, renamePageAction } from "@/app/actions/pages";
import { useChannel } from "@/components/collab/use-channel";
import type { PropertyType, SelectOption, ViewConfig, ViewType } from "@/db/schema/app";
import type { DatabaseSnapshot, Property, Row, View } from "./types";
import { TITLE } from "./types";

type Pending = { rowId: string; key: string; value: unknown; version: number };

async function unwrap<T>(p: Promise<ActionResult<T>>): Promise<T> {
  const res = await p;
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

function message(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong";
}

/**
 * Client state for one database: server snapshot + optimistic overlays, kept fresh through the
 * `db:<id>` signal channel. Cell edits are layered as pending overlays until the server confirms,
 * so a refetch that races an in-flight write never flashes the old value.
 */
export function useDatabase(databaseId: string) {
  const [snapshot, setSnapshot] = useState<DatabaseSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Record<string, Pending>>({});
  const [removed, setRemoved] = useState<Set<string>>(() => new Set());
  const seq = useRef(0);
  const version = useRef(0);

  const refetch = useCallback(async () => {
    const mine = ++seq.current;
    const res = await loadDatabaseAction(databaseId).catch((e: unknown) => ({ ok: false as const, error: message(e) }));
    if (mine !== seq.current) return;
    if (!res.ok) {
      setLoadError(res.error);
      return;
    }
    setLoadError(null);
    setSnapshot(res.data);
  }, [databaseId]);

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

  const report = useCallback((e: unknown) => setError(message(e)), []);

  const rows: Row[] = useMemo(() => {
    if (!snapshot) return [];
    const overlays = Object.values(pending);
    return snapshot.rows
      .filter((r) => !removed.has(r.id))
      .map((row) => {
        const mine = overlays.filter((p) => p.rowId === row.id);
        if (!mine.length) return row;
        const next = { ...row, properties: { ...row.properties } };
        for (const p of mine) {
          if (p.key === TITLE) next.title = String(p.value ?? "");
          else if (p.value === null || p.value === undefined) delete next.properties[p.key];
          else next.properties[p.key] = p.value;
        }
        return next;
      });
  }, [snapshot, pending, removed]);

  const withPending = useCallback(
    async (rowId: string, key: string, value: unknown, write: () => Promise<unknown>) => {
      const token = `${rowId}\u0000${key}`;
      const v = ++version.current;
      setPending((p) => ({ ...p, [token]: { rowId, key, value, version: v } }));
      try {
        await write();
        await refetch();
      } catch (e) {
        report(e);
      } finally {
        setPending((p) => {
          if (p[token]?.version !== v) return p;
          const next = { ...p };
          delete next[token];
          return next;
        });
      }
    },
    [refetch, report],
  );

  const setCell = useCallback(
    (rowId: string, key: string, value: unknown) =>
      withPending(rowId, key, value, async () => {
        if (key === TITLE) await renamePageAction(rowId, String(value ?? ""));
        else await unwrap(updateRowPropertiesAction(rowId, { [key]: value }));
      }),
    [withPending],
  );

  /** Applies a local schema change immediately, then persists it and refetches. */
  const mutateSchema = useCallback(
    async <T,>(local: (s: DatabaseSnapshot) => DatabaseSnapshot, write: () => Promise<ActionResult<T>>) => {
      setSnapshot((s) => (s ? local(s) : s));
      try {
        const data = await unwrap(write());
        return data;
      } catch (e) {
        report(e);
        return null;
      } finally {
        await refetch();
      }
    },
    [refetch, report],
  );

  const patchProperty = (id: string, patch: Partial<Property>) => (s: DatabaseSnapshot) => ({
    ...s,
    properties: s.properties.map((p) => (p.id === id ? { ...p, ...patch } : p)),
  });

  const api = useMemo(
    () => ({
      refetch,
      setCell,
      clearError: () => setError(null),
      report,

      async createRow(input: { title?: string; properties?: Record<string, unknown> } = {}) {
        if (!snapshot) return null;
        try {
          const created = await unwrap(createRowAction(snapshot.database.workspaceId, databaseId, input));
          await refetch();
          return created.id;
        } catch (e) {
          report(e);
          return null;
        }
      },

      async deleteRow(rowId: string) {
        setRemoved((s) => new Set(s).add(rowId));
        try {
          await archivePageAction(rowId);
          await refetch();
        } catch (e) {
          report(e);
        } finally {
          setRemoved((s) => {
            const next = new Set(s);
            next.delete(rowId);
            return next;
          });
        }
      },

      moveRow(rowId: string, move: { position?: number; groupBy?: string; groupValue?: string | null }) {
        setSnapshot((s) =>
          s
            ? {
                ...s,
                rows: s.rows.map((r) => {
                  if (r.id !== rowId) return r;
                  const properties = { ...r.properties };
                  if (move.groupBy) {
                    if (move.groupValue) properties[move.groupBy] = move.groupValue;
                    else delete properties[move.groupBy];
                  }
                  return { ...r, properties, position: move.position ?? r.position };
                }).sort((a, b) => a.position - b.position),
              }
            : s,
        );
        return mutateSchema((s) => s, () => moveRowAction(rowId, move));
      },

      addProperty(name: string, type: PropertyType, options?: string[]) {
        return mutateSchema((s) => s, () => addPropertyAction(databaseId, { name, type, options }));
      },

      renameProperty(id: string, name: string) {
        return mutateSchema(patchProperty(id, { name }), () => updatePropertyAction(id, { name }));
      },

      setOptions(prop: Property, options: SelectOption[]) {
        return mutateSchema(patchProperty(prop.id, { options: { ...prop.options, options } }), () =>
          updatePropertyAction(prop.id, { options }),
        );
      },

      async createOption(propertyId: string, name: string): Promise<SelectOption | null> {
        try {
          const option = await unwrap(ensureOptionAction(propertyId, name));
          setSnapshot((s) =>
            s
              ? {
                  ...s,
                  properties: s.properties.map((p) => {
                    if (p.id !== propertyId) return p;
                    const options = p.options.options ?? [];
                    if (options.some((o) => o.id === option.id)) return p;
                    return { ...p, options: { ...p.options, options: [...options, option] } };
                  }),
                }
              : s,
          );
          return option;
        } catch (e) {
          report(e);
          return null;
        }
      },

      deleteProperty(id: string) {
        return mutateSchema(
          (s) => ({ ...s, properties: s.properties.filter((p) => p.id !== id) }),
          () => deletePropertyAction(id),
        );
      },

      addView(name: string, type: ViewType) {
        return mutateSchema((s) => s, () => addViewAction(databaseId, { name, type }));
      },

      updateView(view: View, patch: { name?: string; config?: ViewConfig }) {
        return mutateSchema(
          (s) => ({
            ...s,
            views: s.views.map((v) =>
              v.id === view.id ? { ...v, ...(patch.name ? { name: patch.name } : {}), ...(patch.config ? { config: patch.config } : {}) } : v,
            ),
          }),
          () => updateViewAction(view.id, patch),
        );
      },

      deleteView(viewId: string) {
        return mutateSchema(
          (s) => ({ ...s, views: s.views.filter((v) => v.id !== viewId) }),
          () => deleteViewAction(viewId),
        );
      },
    }),
    // patchProperty is a pure helper; the rest are stable callbacks.
    [databaseId, snapshot?.database.workspaceId, refetch, setCell, mutateSchema, report],
  );

  return { snapshot, rows, loadError, error, api };
}

export type DatabaseApi = ReturnType<typeof useDatabase>["api"];

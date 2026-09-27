"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn, PageIcon } from "@/components/ui";
import { pageLabel } from "@/lib/labels";
import { isHiddenInView } from "@/lib/properties";
import { CardTitleInput } from "./board-view";
import { RowMenu } from "./gallery-view";
import { isEmptyValue, PropertyDisplay } from "./property-cell";
import { useNewRow } from "./use-new-row";
import { TITLE, type Property, type Row, type View } from "./types";
import type { DatabaseApi } from "./use-database";

/** One compact line per row: title on the left, the properties the view shows on the right. */
export function ListView({
  workspaceId,
  view,
  properties,
  rows,
  api,
  readOnly,
}: {
  workspaceId: string;
  view: View;
  properties: Property[];
  rows: Row[];
  api: DatabaseApi;
  readOnly?: boolean;
}) {
  const t = useTranslations("database");
  const { editTitleOf, typed, create: createNew, stopEditing } = useNewRow((id, title) => void api.setCell(id, TITLE, title));
  const shownProps = properties.filter((p) => !isHiddenInView(view, p));

  const add = async () => {
    await createNew(() => api.createRow());
  };

  return (
    <div className="page-gutter pb-6">
      <div role="list" className="flex flex-col">
        {rows.map((row) => (
          <ListRow
            key={row.id}
            workspaceId={workspaceId}
            row={row}
            props={shownProps}
            readOnly={readOnly}
            editTitle={editTitleOf === row.id}
            typed={typed}
            onTitle={(title) => {
              stopEditing();
              if (title !== row.title) void api.setCell(row.id, TITLE, title);
            }}
            onDelete={() => api.deleteRow(row.id)}
          />
        ))}
      </div>
      {!rows.length && readOnly && <p className="py-10 text-center text-sm text-fg-muted">{t("list.empty")}</p>}
      {!readOnly && (
        <button
          type="button"
          onClick={add}
          className="mt-0.5 flex h-8 w-full items-center gap-1.5 rounded-md px-2 text-sm text-fg-muted hover:bg-bg-hover hover:text-fg"
        >
          <Plus className="h-3.5 w-3.5" />
          {t("list.new")}
        </button>
      )}
    </div>
  );
}

function ListRow({
  workspaceId,
  row,
  props,
  readOnly,
  editTitle,
  typed,
  onTitle,
  onDelete,
}: {
  workspaceId: string;
  row: Row;
  props: Property[];
  readOnly?: boolean;
  editTitle: boolean;
  /** Typed before the title editor opened. */
  typed?: string;
  onTitle: (title: string) => void;
  onDelete: () => void;
}) {
  const tc = useTranslations("common");
  const router = useRouter();
  const href = `/w/${workspaceId}/p/${row.id}`;
  const shown = props.filter((p) => !isEmptyValue(p, row.properties[p.id]));
  return (
    <div
      role="listitem"
      className="group relative flex min-h-9 items-center gap-2 border-b border-border px-2 hover:bg-bg-hover"
    >
      <div
        role="link"
        tabIndex={0}
        onClick={() => !editTitle && router.push(href)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !editTitle && e.target === e.currentTarget) router.push(href);
        }}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 self-stretch rounded-sm"
      >
        <PageIcon icon={row.icon} className="shrink-0" />
        {editTitle ? (
          <CardTitleInput initial={typed || row.title} onDone={onTitle} />
        ) : (
          <span className={cn("min-w-0 truncate text-sm font-medium", !row.title && "text-fg-faint")}>
            {pageLabel(row.title, tc("untitled"))}
          </span>
        )}
        {shown.length > 0 && (
          // Values are chips: they shrink from the left on narrow screens so the title keeps its room.
          <div className="ml-auto flex max-w-[60%] min-w-0 shrink items-center justify-end gap-3 overflow-hidden text-xs text-fg-muted">
            {shown.map((p) => (
              <span key={p.id} className="flex min-w-0 shrink-0 items-center last:shrink" title={p.name}>
                <PropertyDisplay prop={p} value={row.properties[p.id]} />
              </span>
            ))}
          </div>
        )}
      </div>
      {!readOnly && !editTitle && <RowMenu href={href} onDelete={onDelete} className="shrink-0" />}
    </div>
  );
}

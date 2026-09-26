"use client";

import { RotateCcw, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { deletePagePermanentlyAction, listTrashAction, restorePageAction } from "@/app/actions/pages";
import { Dialog, IconButton, PageIcon, pageLabel } from "@/components/ui";

type TrashItem = Awaited<ReturnType<typeof listTrashAction>>[number];

export function TrashDialog({
  workspaceId,
  open,
  onClose,
  onChange,
}: {
  workspaceId: string;
  open: boolean;
  onClose: () => void;
  onChange: () => void;
}) {
  const router = useRouter();
  const [items, setItems] = useState<TrashItem[] | null>(null);
  const [, startTransition] = useTransition();

  const load = () => listTrashAction(workspaceId).then(setItems);
  useEffect(() => {
    if (open) load();
  }, [open, workspaceId]);

  function restore(id: string) {
    startTransition(async () => {
      await restorePageAction(id);
      await load();
      onChange();
    });
  }

  function remove(id: string) {
    if (!confirm("Delete permanently? This cannot be undone.")) return;
    startTransition(async () => {
      await deletePagePermanentlyAction(id);
      await load();
      onChange();
    });
  }

  return (
    <Dialog open={open} onClose={onClose}>
      <div className="border-b border-border px-4 py-3 text-sm font-medium">Trash</div>
      <ul className="max-h-[50vh] overflow-y-auto p-1">
        {items?.length === 0 && <li className="px-3 py-6 text-center text-sm text-fg-muted">Trash is empty</li>}
        {items?.map((item) => (
          <li key={item.id} className="group flex items-center gap-2 rounded-md px-3 py-1.5 hover:bg-bg-hover">
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm"
              onClick={() => {
                onClose();
                router.push(`/w/${workspaceId}/p/${item.id}`);
              }}
            >
              <PageIcon icon={item.icon} kind={item.kind} className="text-sm" />
              <span className="truncate">{pageLabel(item.title)}</span>
            </button>
            <IconButton label="Restore" onClick={() => restore(item.id)}>
              <RotateCcw className="h-3.5 w-3.5" />
            </IconButton>
            <IconButton label="Delete permanently" onClick={() => remove(item.id)} className="hover:text-danger">
              <Trash2 className="h-3.5 w-3.5" />
            </IconButton>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}

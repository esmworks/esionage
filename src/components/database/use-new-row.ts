"use client";

import { useRef, useState } from "react";

function isEditable(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)
  );
}

/**
 * A new row's title editor opens once the server has created the row. Keys typed before that are
 * kept and handed to the editor; Enter or Escape saves them as the title without opening it; and
 * "New" does nothing while a row is still being created, so neither a click nor Enter on the
 * focused button makes a second row.
 */
export function useNewRow(saveTitle: (rowId: string, title: string) => void) {
  const [editing, setEditing] = useState<{ id: string; typed: string } | null>(null);
  const busy = useRef(false);

  const create = async (run: () => Promise<string | null>) => {
    if (busy.current) return;
    busy.current = true;
    let typed = "";
    let finished = false;
    const onKey = (e: KeyboardEvent) => {
      if (finished || e.metaKey || e.ctrlKey || e.altKey || e.isComposing || isEditable(e.target)) return;
      if (e.key === "Enter" || e.key === "Escape") finished = true;
      else if (e.key === "Backspace") typed = typed.slice(0, -1);
      else if (e.key.length === 1) typed += e.key;
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    try {
      const id = await run();
      if (!id) return;
      if (!finished) setEditing({ id, typed });
      else if (typed.trim()) saveTitle(id, typed.trim());
    } finally {
      window.removeEventListener("keydown", onKey, true);
      busy.current = false;
    }
  };

  return {
    /** The row whose title editor is open, if any. */
    editTitleOf: editing?.id ?? null,
    /** What was typed before that editor opened; it starts with this. */
    typed: editing?.typed ?? "",
    create,
    stopEditing: () => setEditing(null),
  };
}

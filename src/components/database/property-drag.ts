"use client";

import { useState } from "react";

export type PropertyDragHandlers = {
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  /** This property is the one being dragged. */
  dragging: boolean;
  /** Where the dragged property would land next to this one. */
  dropSide: "before" | "after" | null;
};

/**
 * Dragging properties to reorder them: table columns along "x", the properties menu along "y".
 * `onMove` gets the dragged property, the one it was dropped on and which side of it.
 */
export function usePropertyDrag(axis: "x" | "y", onMove: (moved: string, target: string, side: "before" | "after") => void) {
  const [dragged, setDragged] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; side: "before" | "after" } | null>(null);
  const end = () => {
    setDragged(null);
    setDrop(null);
  };
  const sideOf = (e: React.DragEvent) => {
    const box = e.currentTarget.getBoundingClientRect();
    const before = axis === "x" ? e.clientX < box.left + box.width / 2 : e.clientY < box.top + box.height / 2;
    return before ? "before" : "after";
  };
  return {
    handlers: (id: string): PropertyDragHandlers => ({
      onDragStart: (e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", id);
        setDragged(id);
      },
      onDragOver: (e) => {
        // Only a property dragged from here; files and text dragged in pass through.
        if (!dragged) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        const side = id === dragged ? null : sideOf(e);
        if (drop?.id !== id || drop.side !== side) setDrop(side ? { id, side } : null);
      },
      onDrop: (e) => {
        if (!dragged) return;
        e.preventDefault();
        if (id !== dragged) onMove(dragged, id, sideOf(e));
        end();
      },
      onDragEnd: end,
      dragging: dragged === id,
      dropSide: drop?.id === id ? drop.side : null,
    }),
  };
}

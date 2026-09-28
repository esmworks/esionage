"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** Phones: the settings items scroll sideways; this brings the open one into view. */
export function SettingsNavScroller({ className, children }: { className: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    const active = el?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!el || !active || el.scrollWidth <= el.clientWidth) return;
    el.scrollLeft = active.offsetLeft - (el.clientWidth - active.offsetWidth) / 2;
  });
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}

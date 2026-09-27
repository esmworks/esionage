"use client";

import { useCallback, useSyncExternalStore } from "react";

/** Phone-sized screens, where the sidebar is a drawer (Tailwind's `max-md`). */
export const PHONE_QUERY = "(max-width: 767px)";

/** Whether a media query matches; false during the server render and hydration. */
export function useMediaQuery(query: string) {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

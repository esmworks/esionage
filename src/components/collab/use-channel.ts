"use client";

import { useEffect, useRef } from "react";
import { acquireDoc } from "./socket";

/**
 * Subscribes to a server signal channel (`ws:<workspaceId>` for the page tree,
 * `db:<databaseId>` for rows/schema). The server broadcasts short event names
 * ("tree", "rows", "schema"); callers refetch in response.
 */
export function useChannel(channel: string | null, onEvent: (event: string) => void) {
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    if (!channel) return;
    const { shared, release } = acquireDoc(channel);
    const unsubscribe = shared.onStateless((event) => handler.current(event));
    return () => {
      unsubscribe();
      release();
    };
  }, [channel]);
}

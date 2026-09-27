"use client";

import { useMemo } from "react";
import { encode } from "uqr";

/** A QR code drawn as one SVG path, dark on white whatever the theme (scanners need the contrast). */
export function QrCode({ value, label, size = 176 }: { value: string; label: string; size?: number }) {
  const { path, modules } = useMemo(() => {
    const { data } = encode(value, { ecc: "M", border: 2 });
    let d = "";
    data.forEach((row, y) =>
      row.forEach((dark, x) => {
        if (dark) d += `M${x} ${y}h1v1h-1z`;
      }),
    );
    return { path: d, modules: data.length };
  }, [value]);
  return (
    <svg
      viewBox={`0 0 ${modules} ${modules}`}
      width={size}
      height={size}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
      className="shrink-0 rounded-md border border-border"
    >
      <rect width={modules} height={modules} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}

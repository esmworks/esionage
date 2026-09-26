import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "esionage", template: "%s · esionage" },
  description: "Open-source workspace for docs and databases, with MCP access for AI agents.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}

import type { NextConfig } from "next";

const config: NextConfig = {
  // Loaded by the custom server too; keep one copy of each in the process.
  serverExternalPackages: ["postgres", "@blocknote/server-util", "jsdom", "yjs"],
  async rewrites() {
    // OAuth / MCP discovery documents must live at the origin root.
    return [{ source: "/.well-known/:path*", destination: "/api/well-known/:path*" }];
  },
};

export default config;

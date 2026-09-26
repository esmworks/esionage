import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const config: NextConfig = {
  // Loaded by the custom server too; keep one copy of each in the process.
  serverExternalPackages: ["postgres", "@blocknote/server-util", "jsdom", "yjs", "nodemailer"],
  async rewrites() {
    // OAuth / MCP discovery documents must live at the origin root.
    return [{ source: "/.well-known/:path*", destination: "/api/well-known/:path*" }];
  },
};

export default createNextIntlPlugin("./src/i18n/request.ts")(config);

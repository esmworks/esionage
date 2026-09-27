import { getTranslations } from "next-intl/server";
import { mcpResource } from "@/lib/env";
import { CopyButton } from "./copy-button";

function Snippet({ value }: { value: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-bg-subtle py-1.5 pr-1.5 pl-3">
      <code className="min-w-0 flex-1 text-xs break-all">{value}</code>
      <CopyButton value={value} />
    </div>
  );
}

/** How to connect Claude and other MCP clients to this Esionage instance. */
export async function McpInstructions() {
  const t = await getTranslations("settings.mcp");
  const url = mcpResource();
  const claudeCode = `claude mcp add --transport http esionage ${url}`;

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{t("heading")}</h2>
        <p className="mt-1 text-sm text-fg-muted">{t("description")}</p>
      </div>

      <div className="space-y-1.5">
        <div className="text-sm font-medium">{t("serverUrl")}</div>
        <Snippet value={url} />
      </div>

      <div className="space-y-4 text-sm">
        <div>
          <h3 className="font-medium">{t("claude.title")}</h3>
          <p className="mt-1 text-fg-muted">{t("claude.body")}</p>
        </div>
        <div className="space-y-1.5">
          <h3 className="font-medium">{t("claudeCode.title")}</h3>
          <p className="text-fg-muted">{t("claudeCode.body")}</p>
          <Snippet value={claudeCode} />
        </div>
        <div>
          <h3 className="font-medium">{t("other.title")}</h3>
          <p className="mt-1 text-fg-muted">{t("other.body")}</p>
        </div>
      </div>
    </section>
  );
}

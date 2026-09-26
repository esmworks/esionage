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
export function McpInstructions() {
  const url = mcpResource();
  const claudeCode = `claude mcp add --transport http esionage ${url}`;

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold">Connect an AI assistant</h2>
        <p className="mt-1 text-sm text-fg-muted">
          Esionage has a built-in MCP server. Assistants that support remote MCP servers can search, read and edit your
          pages and databases after you sign in and approve access. Every edit an assistant makes is saved to page history
          first, so you can undo it.
        </p>
      </div>

      <div className="space-y-1.5">
        <div className="text-sm font-medium">Server URL</div>
        <Snippet value={url} />
      </div>

      <div className="space-y-4 text-sm">
        <div>
          <h3 className="font-medium">Claude</h3>
          <p className="mt-1 text-fg-muted">
            Open Settings, then Connectors, choose Add custom connector and paste the server URL. Claude opens Esionage in
            your browser so you can sign in and allow access.
          </p>
        </div>
        <div className="space-y-1.5">
          <h3 className="font-medium">Claude Code</h3>
          <p className="text-fg-muted">Run this in a terminal, then use /mcp inside Claude Code to sign in.</p>
          <Snippet value={claudeCode} />
        </div>
        <div>
          <h3 className="font-medium">Other MCP clients</h3>
          <p className="mt-1 text-fg-muted">
            Add a remote server with the Streamable HTTP transport and the URL above. The client discovers sign-in through
            standard OAuth 2.1 metadata; it can register itself automatically or use a client ID metadata document.
            Choose read-only access on the approval screen if the client should not edit anything.
          </p>
        </div>
      </div>
    </section>
  );
}

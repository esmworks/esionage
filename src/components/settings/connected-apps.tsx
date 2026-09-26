import { describeScope, safeHttpUrl } from "@/server/mcp/consent";
import { listConnectedApps } from "@/server/mcp/grants";
import { requireUser } from "@/server/session";
import { RevokeAppButton } from "./revoke-app-button";

const dateFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium" });

/** Apps (MCP clients) the current user has authorized, with a way to disconnect each one. */
export async function ConnectedApps() {
  const user = await requireUser();
  const apps = await listConnectedApps(user.id);

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold">Connected apps</h2>
        <p className="mt-1 text-sm text-fg-muted">
          Apps you have allowed to use esionage on your behalf, for example AI assistants connected over MCP.
        </p>
      </div>
      {apps.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-fg-muted">
          No apps are connected yet.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {apps.map((app) => {
            const icon = safeHttpUrl(app.icon);
            const uri = safeHttpUrl(app.uri);
            return (
              <li key={app.clientId} className="flex items-start gap-3 px-4 py-3">
                {icon ? (
                  <img src={icon} alt="" className="h-8 w-8 shrink-0 rounded-md border border-border object-cover" />
                ) : (
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-bg-subtle text-sm font-semibold text-fg-muted">
                    {app.name.slice(0, 1).toUpperCase()}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="truncate text-sm font-medium">{app.name}</span>
                    {uri && (
                      <a href={uri} target="_blank" rel="noreferrer" className="truncate text-xs text-fg-muted hover:underline">
                        {new URL(uri).host}
                      </a>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-fg-muted">
                    Connected {dateFormat.format(app.connectedAt)}
                    {app.updatedAt.getTime() - app.connectedAt.getTime() > 60_000
                      ? `, updated ${dateFormat.format(app.updatedAt)}`
                      : ""}
                  </p>
                  <ul className="mt-1.5 space-y-0.5 text-xs text-fg-muted">
                    {app.scopes.map((scope) => (
                      <li key={scope}>{describeScope(scope)}</li>
                    ))}
                  </ul>
                </div>
                <RevokeAppButton clientId={app.clientId} name={app.name} />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { listWorkspaces } from "@/server/pages";
import { getSession } from "@/server/session";
import { describeScope, getConsentClient, verifySignedAuthorizationQuery } from "@/server/mcp/consent";
import { WRITE_SCOPE } from "@/server/mcp/principal";
import { ConsentForm } from "./consent-form";

export const metadata: Metadata = { title: "Authorize app" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function toQuery(params: Awaited<SearchParams>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    for (const v of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, v);
  }
  return query;
}

function hostOf(url: string | null) {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-full items-center justify-center bg-bg-subtle px-4 py-16">
      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center justify-center gap-2 text-lg font-semibold">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-fg text-sm text-bg">e</span>
          Esionage
        </div>
        <div className="rounded-xl border border-border bg-bg p-6 shadow-sm">{children}</div>
      </div>
    </main>
  );
}

function Problem({ title, body }: { title: string; body: string }) {
  return (
    <Shell>
      <h1 className="text-base font-semibold">{title}</h1>
      <p className="mt-2 text-sm text-fg-muted">{body}</p>
    </Shell>
  );
}

export default async function ConsentPage({ searchParams }: { searchParams: SearchParams }) {
  const query = toQuery(await searchParams);
  const session = await getSession();
  // A session can expire between login and consent; signing in again resumes the flow.
  if (!session) redirect(`/sign-in?${query.toString()}`);

  if (!(await verifySignedAuthorizationQuery(query))) {
    return (
      <Problem
        title="This link has expired"
        body="The authorization request is invalid or too old. Go back to the app you were connecting and start again."
      />
    );
  }

  const clientId = query.get("client_id") ?? "";
  const client = await getConsentClient(clientId);
  if (!client) {
    return (
      <Problem
        title="Unknown app"
        body="The app asking for access is not registered with Esionage or has been disabled. Go back and try connecting again."
      />
    );
  }

  const scopes = (query.get("scope") ?? "").split(" ").filter(Boolean);
  const workspaces = await listWorkspaces(session.user.id);
  const redirectHost = hostOf(query.get("redirect_uri"));
  const siteHost = hostOf(client.uri);

  return (
    <Shell>
      <div className="flex items-start gap-3">
        {client.icon ? (
          // Client logos are arbitrary remote URLs; next/image would need each host allow-listed.
          <img src={client.icon} alt="" className="h-10 w-10 shrink-0 rounded-md border border-border object-cover" />
        ) : (
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-bg-subtle text-base font-semibold text-fg-muted">
            {client.name.slice(0, 1).toUpperCase()}
          </span>
        )}
        <div className="min-w-0">
          <h1 className="text-base font-semibold">
            {client.name} wants to access your Esionage account
          </h1>
          {client.uri && siteHost && (
            <a href={client.uri} target="_blank" rel="noreferrer" className="text-sm text-accent hover:underline">
              {siteHost}
            </a>
          )}
        </div>
      </div>

      <p className="mt-4 text-xs text-fg-muted">
        {client.metadataDocument
          ? `This app is identified by ${hostOf(client.clientId) ?? client.clientId}.`
          : "This app registered itself automatically and has not been reviewed by Esionage. Only continue if you started this connection."}
      </p>

      <ConsentForm
        clientName={client.name}
        user={{ name: session.user.name, email: session.user.email }}
        scopes={scopes
          .filter((s) => s !== WRITE_SCOPE)
          .map((s) => ({ scope: s, label: describeScope(s) }))}
        write={scopes.includes(WRITE_SCOPE) ? { scope: WRITE_SCOPE, label: describeScope(WRITE_SCOPE) } : null}
        workspaces={workspaces.map((w) => w.name)}
        redirectHost={redirectHost}
      />
    </Shell>
  );
}

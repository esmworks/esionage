import Link from "next/link";
import { QuickCreate } from "@/components/workspace/quick-create";
import { PageIcon } from "@/components/ui";
import { pageLabel } from "@/lib/labels";
import { recentPages } from "@/server/pages";
import { requireUser } from "@/server/session";

const timeFormat = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

function ago(date: Date) {
  const minutes = Math.round((date.getTime() - Date.now()) / 60_000);
  if (Math.abs(minutes) < 60) return timeFormat.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return timeFormat.format(hours, "hour");
  return timeFormat.format(Math.round(hours / 24), "day");
}

export default async function WorkspaceHome({ params }: { params: Promise<{ workspaceId: string }> }) {
  const user = await requireUser();
  const { workspaceId } = await params;
  const pages = await recentPages(user.id, workspaceId, 12);

  return (
    <div className="mx-auto max-w-2xl space-y-8 px-6 py-12">
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Welcome back, {user.name.split(/\s+/)[0]}</h1>
        <QuickCreate workspaceId={workspaceId} />
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Recently edited</h2>
        {pages.length === 0 ? (
          <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-fg-muted">
            Nothing here yet. Create your first page to get started.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {pages.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/w/${workspaceId}/p/${p.id}`}
                  className="flex items-center gap-2.5 px-4 py-2.5 text-sm hover:bg-bg-hover"
                >
                  <PageIcon icon={p.icon} kind={p.kind} className="text-fg-muted" />
                  <span className="min-w-0 flex-1 truncate">{pageLabel(p.title)}</span>
                  <span className="shrink-0 text-xs text-fg-muted">{ago(p.updatedAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { QuickCreate } from "@/components/workspace/quick-create";
import { PageIcon } from "@/components/ui";
import { pageLabel } from "@/lib/labels";
import { getMembership, isGuest } from "@/server/access";
import { recentPages } from "@/server/pages";
import { requireUser } from "@/server/session";

export default async function WorkspaceHome({ params }: { params: Promise<{ workspaceId: string }> }) {
  const user = await requireUser();
  const { workspaceId } = await params;
  const [pages, membership] = await Promise.all([
    recentPages(user.id, workspaceId, 12),
    getMembership(user.id, workspaceId),
  ]);
  const [t, tc, format] = await Promise.all([getTranslations("home"), getTranslations("common"), getFormatter()]);
  const now = new Date();
  const guest = !membership || isGuest(membership.role);

  return (
    <div className="mx-auto max-w-2xl space-y-8 px-6 py-12">
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">{t("welcome", { name: user.name.split(/\s+/)[0] })}</h1>
        {!guest && <QuickCreate workspaceId={workspaceId} />}
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">{t("recent")}</h2>
        {pages.length === 0 ? (
          <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-fg-muted">
            {t(guest ? "emptyGuest" : "empty")}
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
                  <span className="min-w-0 flex-1 truncate">{pageLabel(p.title, tc("untitled"))}</span>
                  <span className="shrink-0 text-xs text-fg-muted">{format.relativeTime(p.updatedAt, now)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

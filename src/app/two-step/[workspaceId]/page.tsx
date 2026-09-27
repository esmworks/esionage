import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { isStrongSession } from "@/lib/auth-security";
import { getAccountSecurity } from "@/server/account-security";
import { getMembership } from "@/server/access";
import { listWorkspaces } from "@/server/pages";
import { requireSession } from "@/server/session";
import { workspaceSettings } from "@/server/workspaces";
import { TwoStepGate } from "./two-step-gate";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("security.gate");
  return { title: t("metaTitle") };
}

/**
 * Where a workspace that requires two-step verification sends people whose session doesn't pass
 * it: set up an authenticator app, or use (or add) a passkey, then continue into the workspace.
 */
export default async function TwoStepPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const session = await requireSession();
  const { workspaceId } = await params;
  if (!(await getMembership(session.user.id, workspaceId))) notFound();
  const [settings, workspaces, security, t] = await Promise.all([
    workspaceSettings(workspaceId),
    listWorkspaces(session.user.id),
    getAccountSecurity(session.user.id),
    getTranslations("security.gate"),
  ]);
  if (!settings.requireTwoFactor || isStrongSession(session)) redirect(`/w/${workspaceId}`);
  const current = workspaces.find((w) => w.id === workspaceId);
  const others = workspaces.filter((w) => w.id !== workspaceId);

  return (
    <main className="flex min-h-full items-center justify-center bg-bg-subtle px-4 py-16">
      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center justify-center gap-2 text-lg font-semibold">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-fg text-sm text-bg">e</span>
          Esionage
        </div>
        <div className="rounded-xl border border-border bg-bg p-6 shadow-sm">
          <TwoStepGate
            workspaceId={workspaceId}
            workspaceName={current?.name ?? ""}
            hasPassword={security.hasPassword}
            hasPasskeys={security.passkeys.length > 0}
            email={session.user.email}
          />
        </div>
        {others.length > 0 && (
          <nav aria-label={t("otherWorkspaces")} className="mt-6 space-y-2 text-center text-sm text-fg-muted">
            <p>{t("otherWorkspaces")}</p>
            <ul className="flex flex-wrap justify-center gap-x-4 gap-y-1">
              {others.map((w) => (
                <li key={w.id}>
                  <Link href={`/w/${w.id}`} className="text-accent hover:underline">
                    {w.name}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </div>
    </main>
  );
}

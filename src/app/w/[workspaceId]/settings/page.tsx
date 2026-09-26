import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ConnectedApps } from "@/components/settings/connected-apps";
import { LanguageSettings } from "@/components/settings/language-settings";
import { McpInstructions } from "@/components/settings/mcp-instructions";
import { MembersSection, WorkspaceNameForm } from "@/components/settings/workspace-settings";
import { isLocale, LOCALE_COOKIE } from "@/i18n/config";
import { AccessError } from "@/server/access";
import { requireUser } from "@/server/session";
import { getWorkspace, listMembers } from "@/server/workspaces";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings");
  return { title: t("metaTitle") };
}

export default async function SettingsPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const user = await requireUser();
  const { workspaceId } = await params;
  const loaded = await Promise.all([getWorkspace(user.id, workspaceId), listMembers(user.id, workspaceId)]).catch(
    (error) => {
      if (error instanceof AccessError) return null;
      throw error;
    },
  );
  if (!loaded) notFound();
  const [workspace, members] = loaded;
  const isOwner = workspace.role === "owner";
  const [t, cookieStore] = await Promise.all([getTranslations("settings"), cookies()]);
  const savedLocale = cookieStore.get(LOCALE_COOKIE)?.value;

  return (
    <div className="mx-auto max-w-2xl space-y-10 px-6 py-12">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">{t("workspace.heading")}</h2>
        <WorkspaceNameForm workspaceId={workspaceId} name={workspace.name} canEdit={isOwner} />
      </section>

      <MembersSection
        workspaceId={workspaceId}
        currentUserId={user.id}
        isOwner={isOwner}
        members={members.map((m) => ({ userId: m.userId, name: m.name, email: m.email, role: m.role }))}
      />

      <LanguageSettings current={isLocale(savedLocale) ? savedLocale : null} />

      <ConnectedApps />
      <McpInstructions />
    </div>
  );
}

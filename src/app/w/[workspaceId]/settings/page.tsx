import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ConnectedApps } from "@/components/settings/connected-apps";
import { LanguageSettings } from "@/components/settings/language-settings";
import { McpInstructions } from "@/components/settings/mcp-instructions";
import { MembersPanel } from "@/components/settings/members-panel";
import { WorkspaceNameForm } from "@/components/settings/workspace-settings";
import { isLocale, LOCALE_COOKIE } from "@/i18n/config";
import { AccessError } from "@/server/access";
import { requireUser } from "@/server/session";
import { getJoinLink, getWorkspace, lastEdits, listInvitations, listMembers } from "@/server/workspaces";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings");
  return { title: t("metaTitle") };
}

const TABS = ["general", "members", "preferences", "apps"] as const;
type Tab = (typeof TABS)[number];
const NAV: { group: "account" | "workspace"; tabs: Tab[] }[] = [
  { group: "account", tabs: ["preferences", "apps"] },
  { group: "workspace", tabs: ["general", "members"] },
];

export default async function SettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const [{ workspaceId }, query] = await Promise.all([params, searchParams]);
  const tab: Tab = TABS.find((name) => name === query.tab) ?? "general";
  const workspace = await getWorkspace(user.id, workspaceId).catch((error) => {
    if (error instanceof AccessError) return null;
    throw error;
  });
  if (!workspace) notFound();
  const isOwner = workspace.role === "owner";
  const t = await getTranslations("settings");

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-10 md:flex-row md:gap-10">
      <nav aria-label={t("title")} className="shrink-0 md:w-48">
        <h1 className="mb-4 text-xl font-semibold">{t("title")}</h1>
        <div className="flex gap-6 overflow-x-auto md:flex-col md:gap-5">
          {NAV.map(({ group, tabs }) => (
            <div key={group} className="shrink-0 space-y-1">
              <div className="px-2 text-xs text-fg-faint">{t(`nav.${group}`)}</div>
              <ul className="flex gap-1 md:flex-col md:gap-0.5">
                {tabs.map((name) => (
                  <li key={name}>
                    <Link
                      href={`/w/${workspaceId}/settings?tab=${name}`}
                      aria-current={tab === name ? "page" : undefined}
                      className={`block rounded-md px-2 py-1 text-sm whitespace-nowrap ${
                        tab === name ? "bg-bg-active font-medium" : "text-fg-muted hover:bg-bg-hover hover:text-fg"
                      }`}
                    >
                      {t(`nav.${name}`)}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </nav>

      <div className="min-w-0 flex-1">
        {tab === "general" && (
          <section className="space-y-4">
            <h2 className="text-lg font-semibold">{t("workspace.heading")}</h2>
            <WorkspaceNameForm workspaceId={workspaceId} name={workspace.name} canEdit={isOwner} />
          </section>
        )}
        {tab === "members" && <MembersTab workspaceId={workspaceId} userId={user.id} isOwner={isOwner} />}
        {tab === "preferences" && <PreferencesTab />}
        {tab === "apps" && (
          <div className="space-y-10">
            <ConnectedApps />
            <McpInstructions />
          </div>
        )}
      </div>
    </div>
  );
}

async function MembersTab({ workspaceId, userId, isOwner }: { workspaceId: string; userId: string; isOwner: boolean }) {
  const [members, edits, invitations, joinLink] = await Promise.all([
    listMembers(userId, workspaceId),
    lastEdits(userId, workspaceId),
    isOwner ? listInvitations(userId, workspaceId) : [],
    isOwner ? getJoinLink(userId, workspaceId) : null,
  ]);
  return (
    <MembersPanel
      workspaceId={workspaceId}
      currentUserId={userId}
      isOwner={isOwner}
      members={members.map((m) => ({ ...m, lastEditedAt: edits.get(m.userId) ?? null }))}
      invitations={invitations}
      joinLink={joinLink}
      now={new Date()}
    />
  );
}

async function PreferencesTab() {
  const cookieStore = await cookies();
  const savedLocale = cookieStore.get(LOCALE_COOKIE)?.value;
  return <LanguageSettings current={isLocale(savedLocale) ? savedLocale : null} />;
}

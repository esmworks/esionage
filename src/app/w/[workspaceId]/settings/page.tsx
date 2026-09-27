import { Plug, Settings, SlidersHorizontal, Users, type LucideIcon } from "lucide-react";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ConnectedApps } from "@/components/settings/connected-apps";
import { LanguageSettings } from "@/components/settings/language-settings";
import { McpInstructions } from "@/components/settings/mcp-instructions";
import { MembersPanel } from "@/components/settings/members-panel";
import { SettingsGroup, SettingsHeader } from "@/components/settings/section";
import { WorkspaceNameForm } from "@/components/settings/workspace-settings";
import { isLocale, LOCALE_COOKIE } from "@/i18n/config";
import { AccessError, isGuest } from "@/server/access";
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
const ICONS: Record<Tab, LucideIcon> = {
  preferences: SlidersHorizontal,
  apps: Plug,
  general: Settings,
  members: Users,
};

export default async function SettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const [{ workspaceId }, query] = await Promise.all([params, searchParams]);
  const workspace = await getWorkspace(user.id, workspaceId).catch((error) => {
    if (error instanceof AccessError) return null;
    throw error;
  });
  if (!workspace) notFound();
  const isOwner = workspace.role === "owner";
  // Guests only get their own account settings, not the workspace's.
  const nav = isGuest(workspace.role) ? NAV.filter(({ group }) => group === "account") : NAV;
  const allowed = nav.flatMap(({ tabs }) => tabs);
  const tab: Tab = allowed.find((name) => name === query.tab) ?? (allowed.includes("general") ? "general" : allowed[0]);
  const t = await getTranslations("settings");

  return (
    <div className="flex min-h-full flex-col md:flex-row">
      <nav
        aria-label={t("title")}
        className="shrink-0 border-b border-border px-3 pt-12 pb-3 md:sticky md:top-0 md:h-dvh md:w-60 md:overflow-y-auto md:border-r md:border-b-0 md:pb-4"
      >
        <div className="flex gap-6 overflow-x-auto [scrollbar-width:none] md:flex-col">
          {nav.map(({ group, tabs }) => (
            <div key={group} className="shrink-0">
              <div className="mb-1.5 px-2.5 text-[11px] font-medium tracking-wider text-fg-faint uppercase">
                {t(`nav.${group}`)}
              </div>
              <ul className="flex gap-1 md:flex-col md:gap-0.5">
                {tabs.map((name) => {
                  const Icon = ICONS[name];
                  return (
                    <li key={name}>
                      <Link
                        href={`/w/${workspaceId}/settings?tab=${name}`}
                        aria-current={tab === name ? "page" : undefined}
                        className={`flex h-8 items-center gap-2.5 rounded-md px-2.5 text-sm whitespace-nowrap ${
                          tab === name ? "bg-bg-active font-medium text-fg" : "text-fg-muted hover:bg-bg-hover hover:text-fg"
                        }`}
                      >
                        <Icon className="h-4 w-4 shrink-0" aria-hidden />
                        {t(`nav.${name}`)}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </nav>

      <div className="min-w-0 flex-1 px-4 py-8 sm:px-8 md:py-12">
        <div className="mx-auto max-w-3xl">
          {tab === "general" && (
            <>
              <SettingsHeader title={t("nav.general")} description={t("workspace.description")} />
              <SettingsGroup title={t("workspace.heading")}>
                <WorkspaceNameForm workspaceId={workspaceId} name={workspace.name} canEdit={isOwner} />
              </SettingsGroup>
            </>
          )}
          {tab === "members" && <MembersTab workspaceId={workspaceId} userId={user.id} isOwner={isOwner} />}
          {tab === "preferences" && <PreferencesTab />}
          {tab === "apps" && (
            <>
              <SettingsHeader title={t("nav.apps")} description={t("connectedApps.description")} />
              <div className="space-y-10">
                <ConnectedApps />
                <McpInstructions />
              </div>
            </>
          )}
        </div>
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
  const t = await getTranslations("settings");
  return (
    <>
      <SettingsHeader title={t("nav.preferences")} description={t("preferences.description")} />
      <SettingsGroup title={t("language.heading")}>
        <LanguageSettings current={isLocale(savedLocale) ? savedLocale : null} />
      </SettingsGroup>
    </>
  );
}

import { Boxes, Globe, Settings, Shield, UserRound, Users, UsersRound, type LucideIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { GroupsPanel } from "@/components/settings/groups-panel";
import { AiSettings } from "@/components/settings/ai-settings";
import { LeaveWorkspaceRow } from "@/components/settings/leave-workspace";
import { MembersPanel } from "@/components/settings/members-panel";
import { PublicForms } from "@/components/settings/public-forms";
import { PublishedPages } from "@/components/settings/published-pages";
import {
  GuestInviteSetting,
  GuestPrivatePagesSetting,
  PublishingSetting,
  RequireTwoFactorSetting,
} from "@/components/settings/security-settings";
import { SettingsGroup, SettingsHeader } from "@/components/settings/section";
import { SitePages, SiteSettings } from "@/components/settings/site-settings";
import { TeamspacesPanel } from "@/components/settings/teamspaces-panel";
import { WorkspaceExport } from "@/components/settings/workspace-export";
import { WorkspaceNameForm } from "@/components/settings/workspace-settings";
import { isStrongSession } from "@/lib/auth-security";
import { AccessError, isGuest } from "@/server/access";
import { aiInfo } from "@/server/ai";
import { listWorkspaceFormPublications } from "@/server/forms";
import { groupsByMember, listGroups } from "@/server/groups";
import { listWorkspacePublications } from "@/server/publication";
import { getSession, requireWorkspaceSession } from "@/server/session";
import { getSite } from "@/server/site";
import { canCreateTeamspace, listTeamspaces, teamspacesByMember } from "@/server/teamspaces";
import {
  countMembersWithoutTwoFactor,
  getJoinLink,
  getWorkspace,
  getWorkspaceSettings,
  lastEdits,
  listInvitations,
  listMembers,
} from "@/server/workspaces";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings");
  return { title: t("metaTitle") };
}

const TABS = ["general", "members", "teamspaces", "groups", "security", "site"] as const;
type Tab = (typeof TABS)[number];
/** Tabs that were here before the account page existed, and where they are now. */
const ACCOUNT_TABS: Record<string, string> = { preferences: "preferences", accountSecurity: "security", apps: "apps" };
const ICONS: Record<Tab, LucideIcon> = {
  general: Settings,
  members: Users,
  teamspaces: Boxes,
  groups: UsersRound,
  security: Shield,
  site: Globe,
};

export default async function SettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ workspaceId }, query] = await Promise.all([params, searchParams]);
  // The person's own settings moved to the account page (outside any workspace); old links land there.
  const moved = typeof query.tab === "string" && Object.hasOwn(ACCOUNT_TABS, query.tab) ? ACCOUNT_TABS[query.tab] : null;
  if (moved) redirect(`/account?tab=${moved}&from=${encodeURIComponent(workspaceId)}`);
  const { user } = await requireWorkspaceSession(workspaceId);
  const workspace = await getWorkspace(user.id, workspaceId).catch((error) => {
    if (error instanceof AccessError) return null;
    throw error;
  });
  if (!workspace) notFound();
  const isOwner = workspace.role === "owner";
  const guest = isGuest(workspace.role);
  // Guests don't see the workspace's members or policies: only its name, and leaving it.
  const tabs: Tab[] = guest ? ["general"] : [...TABS];
  const tab: Tab = tabs.find((name) => name === query.tab) ?? "general";
  const t = await getTranslations("settings");
  const navLink = (active: boolean) =>
    `flex h-7 items-center gap-2 rounded-md px-2 whitespace-nowrap ${
      active ? "bg-bg-active font-medium text-fg" : "text-fg-muted hover:bg-bg-hover hover:text-fg"
    }`;

  return (
    <div className="flex min-h-full flex-col md:flex-row">
      <nav
        aria-label={t("title")}
        // Same look as the main sidebar next to it: subtle background, 28px rows, plain section labels.
        className="shrink-0 border-b border-border p-2 text-sm max-md:pl-11 md:sticky md:top-0 md:h-dvh md:w-60 md:overflow-y-auto md:border-r md:border-b-0 md:bg-bg-subtle"
      >
        <div className="flex gap-4 overflow-x-auto [scrollbar-width:none] md:flex-col md:gap-3">
          <div className="shrink-0">
            <div className="px-2 pt-1 pb-1 text-xs font-medium text-fg-muted">{t("nav.workspace")}</div>
            <ul className="flex gap-1 md:flex-col md:gap-px">
              {tabs.map((name) => {
                const Icon = ICONS[name];
                return (
                  <li key={name}>
                    <Link
                      href={`/w/${workspaceId}/settings?tab=${name}`}
                      aria-current={tab === name ? "page" : undefined}
                      className={navLink(tab === name)}
                    >
                      <Icon className="h-4 w-4 shrink-0" aria-hidden />
                      {t(`nav.${name}`)}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
          <div className="shrink-0">
            <div className="px-2 pt-1 pb-1 text-xs font-medium text-fg-muted">{t("nav.account")}</div>
            <Link href={`/account?from=${encodeURIComponent(workspaceId)}`} className={navLink(false)}>
              <UserRound className="h-4 w-4 shrink-0" aria-hidden />
              {t("nav.myAccount")}
            </Link>
          </div>
        </div>
      </nav>

      <div className="min-w-0 flex-1 px-4 py-8 sm:px-8 md:py-12">
        <div className="mx-auto max-w-3xl">
          {tab === "general" && (
            <>
              <SettingsHeader title={t("nav.general")} description={t("workspace.description")} />
              <SettingsGroup title={t("workspace.heading")}>
                <WorkspaceNameForm workspaceId={workspaceId} name={workspace.name} canEdit={isOwner} />
                {/* Guests can't open the members list, where everyone else leaves from. */}
                {guest && <LeaveWorkspaceRow workspaceId={workspaceId} userId={user.id} />}
              </SettingsGroup>
              {!guest && <AiGroup workspaceId={workspaceId} userId={user.id} isOwner={isOwner} />}
              {/* Exporting everything is for owners, like the members list download. */}
              {isOwner && (
                <SettingsGroup title={t("export.heading")} className="mt-10">
                  <WorkspaceExport workspaceId={workspaceId} />
                </SettingsGroup>
              )}
            </>
          )}
          {tab === "members" && <MembersTab workspaceId={workspaceId} userId={user.id} isOwner={isOwner} />}
          {tab === "teamspaces" && <TeamspacesTab workspaceId={workspaceId} userId={user.id} isOwner={isOwner} />}
          {tab === "groups" && <GroupsTab workspaceId={workspaceId} userId={user.id} isOwner={isOwner} />}
          {tab === "security" && <SecurityTab workspaceId={workspaceId} userId={user.id} isOwner={isOwner} />}
          {tab === "site" && (
            <SiteTab workspaceId={workspaceId} workspaceName={workspace.name} userId={user.id} isOwner={isOwner} />
          )}
        </div>
      </div>
    </div>
  );
}

/** Settings > General > AI: the workspace's switch and the server's provider (see server/ai). */
async function AiGroup({ workspaceId, userId, isOwner }: { workspaceId: string; userId: string; isOwner: boolean }) {
  const [settings, t] = await Promise.all([getWorkspaceSettings(userId, workspaceId), getTranslations("ai.settings")]);
  return (
    <SettingsGroup title={t("heading")} description={t("description")} className="mt-10">
      <AiSettings workspaceId={workspaceId} enabled={settings.ai !== false} canEdit={isOwner} provider={aiInfo()} />
    </SettingsGroup>
  );
}

async function SecurityTab({ workspaceId, userId, isOwner }: { workspaceId: string; userId: string; isOwner: boolean }) {
  const [settings, publications, forms, session, withoutTwoFactor, t] = await Promise.all([
    getWorkspaceSettings(userId, workspaceId),
    isOwner ? listWorkspacePublications(userId, workspaceId) : null,
    isOwner ? listWorkspaceFormPublications(userId, workspaceId) : null,
    getSession(),
    isOwner ? countMembersWithoutTwoFactor(userId, workspaceId) : 0,
    getTranslations("settings"),
  ]);
  return (
    <div className="space-y-10">
      <div>
        <SettingsHeader title={t("nav.security")} description={t("security.description")} />
        <SettingsGroup title={t("security.authenticationHeading")}>
          <RequireTwoFactorSetting
            workspaceId={workspaceId}
            settings={settings}
            canEdit={isOwner}
            ownSessionPasses={Boolean(session && isStrongSession(session))}
            withoutTwoFactor={withoutTwoFactor}
          />
        </SettingsGroup>
      </div>
      <div>
        <SettingsGroup title={t("security.guestsHeading")}>
          <GuestInviteSetting workspaceId={workspaceId} settings={settings} canEdit={isOwner} />
          <GuestPrivatePagesSetting workspaceId={workspaceId} settings={settings} canEdit={isOwner} />
        </SettingsGroup>
      </div>
      <SettingsGroup title={t("security.publishingHeading")}>
        <PublishingSetting workspaceId={workspaceId} settings={settings} canEdit={isOwner} />
      </SettingsGroup>
      {publications && (
        <SettingsGroup title={t("security.publications.title")} description={t("security.publications.description")}>
          <PublishedPages workspaceId={workspaceId} publications={publications} />
        </SettingsGroup>
      )}
      {forms && (
        <SettingsGroup title={t("security.forms.title")} description={t("security.forms.description")}>
          <PublicForms workspaceId={workspaceId} forms={forms} />
        </SettingsGroup>
      )}
    </div>
  );
}

async function SiteTab({
  workspaceId,
  workspaceName,
  userId,
  isOwner,
}: {
  workspaceId: string;
  workspaceName: string;
  userId: string;
  isOwner: boolean;
}) {
  const [site, publications, t] = await Promise.all([
    getSite(userId, workspaceId),
    isOwner ? listWorkspacePublications(userId, workspaceId) : null,
    getTranslations("settings"),
  ]);
  return (
    <div className="space-y-10">
      <div>
        <SettingsHeader title={t("nav.site")} description={t("site.description")} />
        <SettingsGroup title={t("site.heading")}>
          <SiteSettings
            // A new form once the site is saved or taken down, starting from what is stored.
            key={site ? `${site.slug}:${site.homePageId}` : "none"}
            workspaceId={workspaceId}
            workspaceName={workspaceName}
            site={site}
            publications={publications}
            canEdit={isOwner}
          />
        </SettingsGroup>
      </div>
      {publications && (
        <SettingsGroup title={t("site.pagesHeading")} description={t("site.pagesDescription")}>
          <SitePages workspaceId={workspaceId} publications={publications} homePageId={site?.homePageId ?? null} />
        </SettingsGroup>
      )}
    </div>
  );
}

async function MembersTab({ workspaceId, userId, isOwner }: { workspaceId: string; userId: string; isOwner: boolean }) {
  const [members, edits, invitations, joinLink, teamspaces, groups] = await Promise.all([
    listMembers(userId, workspaceId),
    lastEdits(userId, workspaceId),
    isOwner ? listInvitations(userId, workspaceId) : [],
    isOwner ? getJoinLink(userId, workspaceId) : null,
    teamspacesByMember(userId, workspaceId),
    groupsByMember(userId, workspaceId),
  ]);
  return (
    <MembersPanel
      workspaceId={workspaceId}
      currentUserId={userId}
      isOwner={isOwner}
      members={members.map((m) => ({ ...m, lastEditedAt: edits.get(m.userId) ?? null }))}
      invitations={invitations}
      joinLink={joinLink}
      // A plain object: a Map doesn't cross to the client component.
      teamspaces={Object.fromEntries(teamspaces)}
      groups={Object.fromEntries(groups)}
      now={new Date()}
    />
  );
}

async function GroupsTab({ workspaceId, userId, isOwner }: { workspaceId: string; userId: string; isOwner: boolean }) {
  const [groups, members] = await Promise.all([listGroups(userId, workspaceId), listMembers(userId, workspaceId)]);
  return (
    <GroupsPanel
      workspaceId={workspaceId}
      isOwner={isOwner}
      groups={groups}
      members={members.map(({ userId: id, name, email, image, role }) => ({ userId: id, name, email, image, role }))}
    />
  );
}

async function TeamspacesTab({ workspaceId, userId, isOwner }: { workspaceId: string; userId: string; isOwner: boolean }) {
  const [teamspaces, canCreate, settings, members] = await Promise.all([
    listTeamspaces(userId, workspaceId, { archived: "all" }),
    canCreateTeamspace(userId, workspaceId),
    getWorkspaceSettings(userId, workspaceId),
    listMembers(userId, workspaceId),
  ]);
  return (
    <TeamspacesPanel
      workspaceId={workspaceId}
      currentUserId={userId}
      isOwner={isOwner}
      teamspaces={teamspaces}
      canCreate={canCreate}
      teamspaceCreation={settings.teamspaceCreation}
      members={members.map(({ userId: id, name, email, role }) => ({ userId: id, name, email, role }))}
      now={new Date()}
    />
  );
}

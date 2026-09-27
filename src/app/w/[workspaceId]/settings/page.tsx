import { Boxes, Globe, KeyRound, Plug, Settings, Shield, SlidersHorizontal, Users, type LucideIcon } from "lucide-react";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ApiTokens } from "@/components/settings/api-tokens";
import { ConnectedApps } from "@/components/settings/connected-apps";
import { LanguageSettings } from "@/components/settings/language-settings";
import { LeaveWorkspaceRow } from "@/components/settings/leave-workspace";
import { McpInstructions } from "@/components/settings/mcp-instructions";
import { MembersPanel } from "@/components/settings/members-panel";
import { NotificationSettings } from "@/components/settings/notification-settings";
import { PublicForms } from "@/components/settings/public-forms";
import { PublishedPages } from "@/components/settings/published-pages";
import { PasskeySettings } from "@/components/security/passkeys";
import { TwoFactorSettings } from "@/components/security/two-factor";
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
import { isLocale, LOCALE_COOKIE } from "@/i18n/config";
import { isStrongSession } from "@/lib/auth-security";
import { getAccountSecurity } from "@/server/account-security";
import { AccessError, isGuest } from "@/server/access";
import { listWorkspaceFormPublications } from "@/server/forms";
import { mailStatus } from "@/server/mail";
import { getNotificationPreferences } from "@/server/notification-preferences";
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

const TABS = ["general", "members", "teamspaces", "security", "site", "preferences", "accountSecurity", "apps"] as const;
type Tab = (typeof TABS)[number];
const NAV: { group: "account" | "workspace"; tabs: Tab[] }[] = [
  { group: "account", tabs: ["preferences", "accountSecurity", "apps"] },
  { group: "workspace", tabs: ["general", "members", "teamspaces", "security", "site"] },
];
const ICONS: Record<Tab, LucideIcon> = {
  preferences: SlidersHorizontal,
  accountSecurity: KeyRound,
  apps: Plug,
  general: Settings,
  members: Users,
  teamspaces: Boxes,
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
  const { user } = await requireWorkspaceSession(workspaceId);
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
        // Same look as the main sidebar next to it: subtle background, 28px rows, plain section labels.
        className="shrink-0 border-b border-border p-2 text-sm max-md:pl-11 md:sticky md:top-0 md:h-dvh md:w-60 md:overflow-y-auto md:border-r md:border-b-0 md:bg-bg-subtle"
      >
        <div className="flex gap-4 overflow-x-auto [scrollbar-width:none] md:flex-col md:gap-3">
          {nav.map(({ group, tabs }) => (
            <div key={group} className="shrink-0">
              <div className="px-2 pt-1 pb-1 text-xs font-medium text-fg-muted">
                {t(`nav.${group}`)}
              </div>
              <ul className="flex gap-1 md:flex-col md:gap-px">
                {tabs.map((name) => {
                  const Icon = ICONS[name];
                  return (
                    <li key={name}>
                      <Link
                        href={`/w/${workspaceId}/settings?tab=${name}`}
                        aria-current={tab === name ? "page" : undefined}
                        className={`flex h-7 items-center gap-2 rounded-md px-2 whitespace-nowrap ${
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
          {tab === "security" && <SecurityTab workspaceId={workspaceId} userId={user.id} isOwner={isOwner} />}
          {tab === "site" && (
            <SiteTab workspaceId={workspaceId} workspaceName={workspace.name} userId={user.id} isOwner={isOwner} />
          )}
          {tab === "preferences" && (
            <PreferencesTab workspaceId={workspaceId} userId={user.id} guest={isGuest(workspace.role)} />
          )}
          {tab === "accountSecurity" && <AccountSecurityTab userId={user.id} />}
          {tab === "apps" && (
            <>
              <SettingsHeader title={t("nav.apps")} description={t("connectedApps.description")} />
              <div className="space-y-10">
                <ConnectedApps />
                <McpInstructions />
                <ApiTokens />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

async function AccountSecurityTab({ userId }: { userId: string }) {
  const [security, t] = await Promise.all([getAccountSecurity(userId), getTranslations("security")]);
  return (
    <>
      <SettingsHeader title={t("title")} description={t("description")} />
      <div className="space-y-10">
        <SettingsGroup title={t("twoFactor.heading")} description={t("twoFactor.headingDescription")}>
          <TwoFactorSettings enabled={security.twoFactorEnabled} hasPassword={security.hasPassword} />
        </SettingsGroup>
        <SettingsGroup title={t("passkeys.heading")} description={t("passkeys.headingDescription")}>
          <PasskeySettings passkeys={security.passkeys} />
        </SettingsGroup>
        <p className="text-sm text-fg-muted">{t("connectedAppsNote")}</p>
      </div>
    </>
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
  const [members, edits, invitations, joinLink, teamspaces] = await Promise.all([
    listMembers(userId, workspaceId),
    lastEdits(userId, workspaceId),
    isOwner ? listInvitations(userId, workspaceId) : [],
    isOwner ? getJoinLink(userId, workspaceId) : null,
    teamspacesByMember(userId, workspaceId),
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
      now={new Date()}
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

async function PreferencesTab({ workspaceId, userId, guest }: { workspaceId: string; userId: string; guest: boolean }) {
  const [cookieStore, notificationPreferences] = await Promise.all([cookies(), getNotificationPreferences(userId)]);
  const savedLocale = cookieStore.get(LOCALE_COOKIE)?.value;
  const t = await getTranslations("settings");
  return (
    <>
      <SettingsHeader title={t("nav.preferences")} description={t("preferences.description")} />
      <div className="space-y-10">
        <SettingsGroup title={t("language.heading")}>
          <LanguageSettings current={isLocale(savedLocale) ? savedLocale : null} />
        </SettingsGroup>
        <SettingsGroup
          title={t("notifications.heading")}
          description={
            <>
              {t("notifications.description")}
              {mailStatus() === "disabled" && <> {t("notifications.mailOff")}</>}
            </>
          }
        >
          <NotificationSettings preferences={notificationPreferences} />
        </SettingsGroup>
        {/* Guests can't open the members list, where everyone else leaves from. */}
        {guest && (
          <SettingsGroup title={t("nav.workspace")}>
            <LeaveWorkspaceRow workspaceId={workspaceId} userId={userId} />
          </SettingsGroup>
        )}
      </div>
    </>
  );
}

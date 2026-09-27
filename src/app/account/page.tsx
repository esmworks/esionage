import { ArrowLeft, KeyRound, Plug, SlidersHorizontal, UserRound, type LucideIcon } from "lucide-react";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AccountEmailSettings } from "@/components/account/email-settings";
import { DeleteAccountSettings } from "@/components/account/delete-account";
import { PasswordSettings } from "@/components/account/password-settings";
import { ProfileSettings } from "@/components/account/profile-settings";
import { SessionList } from "@/components/account/session-list";
import { PasskeySettings } from "@/components/security/passkeys";
import { TwoFactorSettings } from "@/components/security/two-factor";
import { ApiTokens } from "@/components/settings/api-tokens";
import { ConnectedApps } from "@/components/settings/connected-apps";
import { LanguageSettings } from "@/components/settings/language-settings";
import { McpInstructions } from "@/components/settings/mcp-instructions";
import { NotificationSettings } from "@/components/settings/notification-settings";
import { SettingsGroup, SettingsHeader } from "@/components/settings/section";
import { isLocale, LOCALE_COOKIE } from "@/i18n/config";
import { FRESH_SIGN_IN_MINUTES, proofKindFor } from "@/lib/account";
import { getAccountOverview, deletionPlanFor, emailChangeEnabled } from "@/server/account";
import { getAccountSecurity } from "@/server/account-security";
import { mailStatus } from "@/server/mail";
import { getNotificationPreferences } from "@/server/notification-preferences";
import { listWorkspaces } from "@/server/pages";
import { requireSession } from "@/server/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("account");
  return { title: t("metaTitle") };
}

const TABS = ["profile", "security", "preferences", "apps"] as const;
type Tab = (typeof TABS)[number];
const ICONS: Record<Tab, LucideIcon> = {
  profile: UserRound,
  security: KeyRound,
  preferences: SlidersHorizontal,
  apps: Plug,
};

/**
 * The signed-in person's own account, outside any workspace: profile, email, password, two-step
 * verification, passkeys, sessions, connected apps, language and notifications, and deleting the
 * account. Being outside /w/ keeps it open to someone a workspace's two-step policy holds back
 * (they come here to set it up) and to someone with no workspace at all.
 *
 * `?from=<workspace id>` is where "Back" goes (the sidebar menu passes the current workspace).
 */
export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [session, query] = await Promise.all([requireSession(), searchParams]);
  const tab: Tab = TABS.find((name) => name === query.tab) ?? "profile";
  const [workspaces, t] = await Promise.all([listWorkspaces(session.user.id), getTranslations("account")]);
  const from = workspaces.find((w) => w.id === query.from) ?? workspaces[0];
  const suffix = from && from.id !== workspaces[0]?.id ? `&from=${encodeURIComponent(from.id)}` : "";

  return (
    <div className="flex min-h-full flex-col md:flex-row">
      <nav
        aria-label={t("title")}
        // Same look as the settings next to a workspace: subtle background, 28px rows.
        className="shrink-0 border-b border-border p-2 text-sm md:sticky md:top-0 md:h-dvh md:w-60 md:overflow-y-auto md:border-r md:border-b-0 md:bg-bg-subtle"
      >
        <Link
          href={from ? `/w/${from.id}` : "/"}
          className="mb-2 flex h-7 items-center gap-2 rounded-md px-2 text-fg-muted hover:bg-bg-hover hover:text-fg"
        >
          <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden />
          <span className="truncate">{from ? t("back", { workspace: from.name }) : t("backHome")}</span>
        </Link>
        <div className="px-2 pt-1 pb-1 text-xs font-medium text-fg-muted">{t("title")}</div>
        <ul className="flex gap-1 overflow-x-auto [scrollbar-width:none] md:flex-col md:gap-px">
          {TABS.map((name) => {
            const Icon = ICONS[name];
            return (
              <li key={name} className="shrink-0">
                <Link
                  href={`/account?tab=${name}${suffix}`}
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
      </nav>

      <main className="min-w-0 flex-1 px-4 py-8 sm:px-8 md:py-12">
        <div className="mx-auto max-w-3xl">
          {tab === "profile" && <ProfileTab session={session} />}
          {tab === "security" && <SecurityTab session={session} />}
          {tab === "preferences" && <PreferencesTab userId={session.user.id} />}
          {tab === "apps" && (
            <>
              <SettingsHeader title={t("nav.apps")} description={t("apps.description")} />
              <div className="space-y-10">
                <ConnectedApps />
                <McpInstructions />
                <ApiTokens />
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

type Session = Awaited<ReturnType<typeof requireSession>>;

/** Whether the session was signed in recently enough to confirm changes without a password or code. */
function signedInRecently(session: Session) {
  return Date.now() - new Date(session.session.createdAt).getTime() < FRESH_SIGN_IN_MINUTES * 60_000;
}

async function ProfileTab({ session }: { session: Session }) {
  const [overview, plan, t] = await Promise.all([
    getAccountOverview(session),
    deletionPlanFor(session.user.id),
    getTranslations("account"),
  ]);
  const proof = { kind: proofKindFor(overview), recent: signedInRecently(session) };
  return (
    <>
      <SettingsHeader title={t("nav.profile")} description={t("profile.description")} />
      <div className="space-y-10">
        <SettingsGroup title={t("profile.heading")}>
          <ProfileSettings name={overview.name} image={overview.image} />
        </SettingsGroup>
        <SettingsGroup title={t("email.heading")}>
          <AccountEmailSettings
            email={overview.email}
            pendingEmail={overview.pendingEmail}
            enabled={emailChangeEnabled()}
            proof={proof}
          />
        </SettingsGroup>
        <SettingsGroup title={t("delete.heading")}>
          <DeleteAccountSettings email={overview.email} plan={plan} proof={proof} />
        </SettingsGroup>
      </div>
    </>
  );
}

async function SecurityTab({ session }: { session: Session }) {
  const [overview, security, t, ts] = await Promise.all([
    getAccountOverview(session),
    getAccountSecurity(session.user.id),
    getTranslations("account"),
    getTranslations("security"),
  ]);
  const proof = { kind: proofKindFor(overview), recent: signedInRecently(session) };
  return (
    <>
      <SettingsHeader title={t("nav.security")} description={ts("description")} />
      <div className="space-y-10">
        <SettingsGroup title={t("password.heading")}>
          <PasswordSettings hasPassword={overview.hasPassword} providers={overview.providers} proof={proof} />
        </SettingsGroup>
        <SettingsGroup title={ts("twoFactor.heading")} description={ts("twoFactor.headingDescription")}>
          <TwoFactorSettings enabled={security.twoFactorEnabled} hasPassword={security.hasPassword} />
        </SettingsGroup>
        <SettingsGroup title={ts("passkeys.heading")} description={ts("passkeys.headingDescription")}>
          <PasskeySettings passkeys={security.passkeys} />
        </SettingsGroup>
        <SessionList sessions={overview.sessions} />
        <p className="text-sm text-fg-muted">{ts("connectedAppsNote")}</p>
      </div>
    </>
  );
}

async function PreferencesTab({ userId }: { userId: string }) {
  const [cookieStore, notificationPreferences, t, ts] = await Promise.all([
    cookies(),
    getNotificationPreferences(userId),
    getTranslations("account"),
    getTranslations("settings"),
  ]);
  const savedLocale = cookieStore.get(LOCALE_COOKIE)?.value;
  return (
    <>
      <SettingsHeader title={t("nav.preferences")} description={ts("preferences.description")} />
      <div className="space-y-10">
        <SettingsGroup title={ts("language.heading")}>
          <LanguageSettings current={isLocale(savedLocale) ? savedLocale : null} />
        </SettingsGroup>
        <SettingsGroup
          title={ts("notifications.heading")}
          description={
            <>
              {ts("notifications.description")}
              {mailStatus() === "disabled" && <> {ts("notifications.mailOff")}</>}
            </>
          }
        >
          <NotificationSettings preferences={notificationPreferences} />
        </SettingsGroup>
      </div>
    </>
  );
}

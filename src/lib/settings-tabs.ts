/** The workspace settings tabs, in the order the settings navigation shows them. */
export const SETTINGS_TABS = ["general", "members", "guests", "teamspaces", "groups", "analytics", "security", "audit", "site"] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

/** Tabs only the workspace's owners get. */
const OWNER_TABS: readonly SettingsTab[] = ["analytics", "audit"];

/**
 * The tabs someone gets. Guests don't see the workspace's members or policies: only its name, and
 * leaving it. The guests themselves are for those who may bring guests in (`canInviteGuests`:
 * owners, and members when Settings > Security lets them). Analytics, which counts what each
 * person did, and the audit log, which says who changed what, are for owners.
 */
export function visibleSettingsTabs({
  guest,
  managesGuests,
  owner = false,
}: {
  guest: boolean;
  managesGuests: boolean;
  owner?: boolean;
}): SettingsTab[] {
  if (guest) return ["general"];
  return SETTINGS_TABS.filter((tab) => (tab !== "guests" || managesGuests) && (!OWNER_TABS.includes(tab) || owner));
}

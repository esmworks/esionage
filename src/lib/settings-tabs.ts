/** The workspace settings tabs, in the order the settings navigation shows them. */
export const SETTINGS_TABS = ["general", "members", "guests", "teamspaces", "groups", "security", "site"] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

/**
 * The tabs someone gets. Guests don't see the workspace's members or policies: only its name, and
 * leaving it. The guests themselves are for those who may bring guests in (`canInviteGuests`:
 * owners, and members when Settings > Security lets them).
 */
export function visibleSettingsTabs({ guest, managesGuests }: { guest: boolean; managesGuests: boolean }): SettingsTab[] {
  if (guest) return ["general"];
  return SETTINGS_TABS.filter((tab) => tab !== "guests" || managesGuests);
}

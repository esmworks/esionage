"use client";

import { MoreHorizontal, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import {
  joinTeamspaceAction,
  leaveTeamspaceAction,
  setTeamspaceArchivedAction,
  updateTeamspaceAction,
} from "@/app/actions/teamspaces";
import { updateWorkspaceSettingsAction } from "@/app/actions/workspaces";
import { Floating, useFloating } from "@/components/database/floating";
import { SettingsGroup, SettingsHeader, SettingsRow } from "@/components/settings/section";
import { selectClass, useAction } from "@/components/settings/workspace-settings";
import { ACCESS_OPTIONS, TeamspaceDialog } from "@/components/teamspaces/teamspace-dialog";
import { TeamspaceMembersDialog } from "@/components/teamspaces/teamspace-members-dialog";
import { Button, cn, Dialog, IconButton, Input, MenuItem, MenuSeparator, Switch } from "@/components/ui";
import type { TeamspaceAccess } from "@/db/schema/app";
import type { TeamspaceSummary } from "@/server/teamspaces";
import { searchFold } from "@/lib/search-fold";

type Person = { userId: string; name: string; email: string; role: "owner" | "member" | "guest" };

function matches(query: string, ...values: string[]) {
  const q = searchFold(query.trim());
  return !q || values.some((v) => searchFold(v).includes(q));
}

/** Settings > Teamspaces: every teamspace the viewer can see, the default ones and who may create them. */
export function TeamspacesPanel({
  workspaceId,
  currentUserId,
  isOwner,
  teamspaces,
  canCreate,
  teamspaceCreation,
  members,
  now,
}: {
  workspaceId: string;
  currentUserId: string;
  /** The viewer owns the workspace. */
  isOwner: boolean;
  /** Active and archived ones alike. */
  teamspaces: TeamspaceSummary[];
  canCreate: boolean;
  teamspaceCreation: "owners" | "members";
  /** Everyone in the workspace, for adding people to a teamspace. */
  members: Person[];
  /** Render time from the server, so relative dates match between server and client render. */
  now: Date;
}) {
  const t = useTranslations("settings.teamspaces");
  const ta = useTranslations("teamspaces.access");
  const router = useRouter();
  const [status, setStatus] = useState<"active" | "archived">("active");
  const [query, setQuery] = useState("");
  const [owner, setOwner] = useState("");
  const [access, setAccess] = useState<TeamspaceAccess | "">("");
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [managingId, setManagingId] = useState<string | null>(null);
  // Looked up by id so the dialogs follow the refreshed props after each change.
  const editing = teamspaces.find((ts) => ts.id === editingId);
  const managing = teamspaces.find((ts) => ts.id === managingId);

  const active = teamspaces.filter((ts) => !ts.archivedAt);
  const archived = teamspaces.filter((ts) => ts.archivedAt);
  const inStatus = status === "active" ? active : archived;
  const owners = useMemo(() => {
    const byId = new Map<string, string>();
    for (const ts of teamspaces) for (const o of ts.owners) byId.set(o.id, o.name);
    return [...byId].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [teamspaces]);
  const shown = inStatus.filter(
    (ts) =>
      matches(query, ts.name) && (!owner || ts.owners.some((o) => o.id === owner)) && (!access || ts.access === access),
  );

  return (
    <div>
      <SettingsHeader title={t("heading")} description={t("description")} />

      <div className="space-y-10">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div role="tablist" aria-label={t("heading")} className="inline-flex gap-0.5 rounded-lg bg-bg-hover p-0.5">
              <TabButton active={status === "active"} onClick={() => setStatus("active")}>
                {t("status.active")} <span className="text-fg-faint">{active.length}</span>
              </TabButton>
              <TabButton active={status === "archived"} onClick={() => setStatus("archived")}>
                {t("status.archived")} <span className="text-fg-faint">{archived.length}</span>
              </TabButton>
            </div>
            {canCreate && (
              <Button variant="primary" className="ml-auto" onClick={() => setCreating(true)}>
                {t("newButton")}
              </Button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-0 flex-1 sm:flex-none">
              <Search className="pointer-events-none absolute top-1/2 left-2 h-3.5 w-3.5 -translate-y-1/2 text-fg-faint" />
              <Input
                type="search"
                aria-label={t("search")}
                placeholder={t("search")}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-7 sm:w-56"
              />
            </div>
            <select aria-label={t("ownerFilter")} className={selectClass} value={owner} onChange={(e) => setOwner(e.target.value)}>
              <option value="">{t("anyOwner")}</option>
              {owners.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
            <select
              aria-label={t("accessFilter")}
              className={selectClass}
              value={access}
              onChange={(e) => setAccess(e.target.value as TeamspaceAccess | "")}
            >
              <option value="">{t("anyAccess")}</option>
              {ACCESS_OPTIONS.map((a) => (
                <option key={a} value={a}>
                  {ta(a)}
                </option>
              ))}
            </select>
          </div>

          <div className="overflow-hidden rounded-xl border border-border">
            {shown.length ? (
              // `relative` keeps the absolutely positioned sr-only header text inside the scroller.
              <div className="relative overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead className="border-b border-border bg-bg-subtle text-xs text-fg-muted">
                    <tr>
                      <th scope="col" className="px-4 py-2.5 text-left font-normal">
                        {t("columns.teamspace")}
                      </th>
                      <th scope="col" className="w-24 px-4 py-2.5 text-left font-normal">
                        {t("columns.members")}
                      </th>
                      <th scope="col" className="w-44 px-4 py-2.5 text-left font-normal">
                        {t("columns.owners")}
                      </th>
                      <th scope="col" className="w-28 px-4 py-2.5 text-left font-normal">
                        {t("columns.access")}
                      </th>
                      <th scope="col" className="w-32 px-4 py-2.5 text-left font-normal">
                        {t("columns.updated")}
                      </th>
                      <th scope="col" className="w-10">
                        <span className="sr-only">{t("columns.actions")}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {shown.map((ts) => (
                      <TeamspaceRow
                        key={ts.id}
                        workspaceId={workspaceId}
                        teamspace={ts}
                        now={now}
                        onEdit={() => setEditingId(ts.id)}
                        onMembers={() => setManagingId(ts.id)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="px-4 py-8 text-center text-sm text-fg-muted">
                {inStatus.length ? t("noMatches") : status === "active" ? t("empty") : t("emptyArchived")}
              </p>
            )}
          </div>
        </div>

        <DefaultTeamspaces workspaceId={workspaceId} isOwner={isOwner} teamspaces={active} />

        <SettingsGroup title={t("policyHeading")}>
          <CreationSetting workspaceId={workspaceId} value={teamspaceCreation} canEdit={isOwner} />
        </SettingsGroup>
      </div>

      <TeamspaceDialog
        workspaceId={workspaceId}
        open={creating}
        onClose={() => setCreating(false)}
        isWorkspaceOwner={isOwner}
      />
      {editing && (
        <TeamspaceDialog
          workspaceId={workspaceId}
          open
          onClose={() => setEditingId(null)}
          teamspace={editing}
          isWorkspaceOwner={isOwner}
        />
      )}
      {managing && (
        <TeamspaceMembersDialog
          workspaceId={workspaceId}
          teamspace={managing}
          open
          onClose={() => setManagingId(null)}
          workspaceMembers={members}
          currentUserId={currentUserId}
          onChanged={() => router.refresh()}
        />
      )}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "flex h-7 items-center gap-1.5 rounded-md px-2.5 text-sm transition-colors",
        active ? "bg-bg font-medium text-fg shadow-sm" : "text-fg-muted hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}

function TeamspaceName({ teamspace }: { teamspace: Pick<TeamspaceSummary, "icon" | "name"> }) {
  return (
    <>
      <span
        aria-hidden
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-bg-active text-sm leading-none font-medium text-fg-muted"
      >
        {teamspace.icon ?? (teamspace.name.trim()[0] ?? "?").toLocaleUpperCase()}
      </span>
      <span className="truncate font-medium">{teamspace.name}</span>
    </>
  );
}

type PendingConfirm = "leave" | "archive" | null;

function TeamspaceRow({
  workspaceId,
  teamspace,
  now,
  onEdit,
  onMembers,
}: {
  workspaceId: string;
  teamspace: TeamspaceSummary;
  now: Date;
  onEdit: () => void;
  onMembers: () => void;
}) {
  const t = useTranslations("settings.teamspaces");
  const ta = useTranslations("teamspaces.access");
  const tc = useTranslations("common");
  const format = useFormatter();
  const router = useRouter();
  const menu = useFloating<HTMLButtonElement>();
  const { pending, error, run } = useAction();
  const [confirm, setConfirm] = useState<PendingConfirm>(null);
  const ownerNames = teamspace.owners.map((o) => o.name).join(", ");
  const done = () => {
    setConfirm(null);
    router.refresh();
  };
  const pick = (action: () => void) => () => {
    menu.close();
    action();
  };

  return (
    <tr className="align-middle">
      <td className="px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <TeamspaceName teamspace={teamspace} />
          {teamspace.joined && (
            <span className="shrink-0 rounded bg-bg-active px-1.5 text-xs leading-5 text-fg-muted">{t("joined")}</span>
          )}
        </div>
        {teamspace.description && <div className="mt-0.5 truncate pl-8.5 text-xs text-fg-muted">{teamspace.description}</div>}
        {error && <p className="mt-1 text-xs text-danger">{error}</p>}
      </td>
      <td className="px-4 py-3 text-fg-muted tabular-nums">{format.number(teamspace.memberCount)}</td>
      <td className="max-w-44 px-4 py-3">
        {ownerNames ? (
          <div className="truncate text-fg-muted" title={ownerNames}>
            {ownerNames}
          </div>
        ) : (
          <span className="text-fg-faint">{t("noOwners")}</span>
        )}
      </td>
      <td className="px-4 py-3 whitespace-nowrap text-fg-muted">{ta(teamspace.access)}</td>
      <td className="px-4 py-3 whitespace-nowrap text-fg-muted">
        <time
          dateTime={teamspace.updatedAt.toISOString()}
          title={format.dateTime(teamspace.updatedAt, { dateStyle: "medium", timeStyle: "short" })}
        >
          {format.relativeTime(teamspace.updatedAt, now)}
        </time>
      </td>
      <td className="px-1 py-2.5 text-right">
        <IconButton ref={menu.ref} label={t("actionsFor", { name: teamspace.name })} onClick={menu.toggle} disabled={pending}>
          <MoreHorizontal className="h-4 w-4" />
        </IconButton>
        {/* Portaled so the table's scroll container doesn't clip it. */}
        <Floating anchor={menu.el} open={menu.open} onClose={menu.close} align="end" className="text-left">
          {teamspace.canManage && <MenuItem onClick={pick(onEdit)}>{t("edit")}</MenuItem>}
          <MenuItem onClick={pick(onMembers)}>{teamspace.canManage ? t("manageMembers") : t("viewMembers")}</MenuItem>
          {(teamspace.canJoin || teamspace.canLeave || teamspace.canManage) && <MenuSeparator />}
          {teamspace.canJoin && (
            <MenuItem onClick={pick(() => run(() => joinTeamspaceAction(workspaceId, teamspace.id), done))}>{t("join")}</MenuItem>
          )}
          {teamspace.canLeave && <MenuItem onClick={pick(() => setConfirm("leave"))}>{t("leave")}</MenuItem>}
          {teamspace.canManage &&
            (teamspace.archivedAt ? (
              <MenuItem
                onClick={pick(() => run(() => setTeamspaceArchivedAction(workspaceId, teamspace.id, false), done))}
              >
                {t("restore")}
              </MenuItem>
            ) : (
              <MenuItem danger onClick={pick(() => setConfirm("archive"))}>
                {t("archive")}
              </MenuItem>
            ))}
        </Floating>
        <Dialog open={confirm !== null} onClose={() => setConfirm(null)} className="max-w-md text-left">
          <div className="space-y-3 p-5">
            <h2 className="text-base font-semibold">
              {confirm === "leave" ? t("leaveTitle", { name: teamspace.name }) : t("archiveTitle", { name: teamspace.name })}
            </h2>
            <p className="text-sm text-fg-muted">{confirm === "leave" ? t("leaveBody") : t("archiveBody")}</p>
            {error && <p className="text-xs text-danger">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setConfirm(null)}>
                {tc("cancel")}
              </Button>
              <Button
                variant="danger"
                disabled={pending}
                onClick={() =>
                  confirm === "leave"
                    ? run(() => leaveTeamspaceAction(workspaceId, teamspace.id), done)
                    : run(() => setTeamspaceArchivedAction(workspaceId, teamspace.id, true), done)
                }
              >
                {confirm === "leave" ? t("leave") : t("archive")}
              </Button>
            </div>
          </div>
        </Dialog>
      </td>
    </tr>
  );
}

/**
 * The teamspaces everyone is in. Being in them is implicit (for everyone who joins later too), so
 * there is nothing to sync: owners only choose which teamspaces are default.
 */
function DefaultTeamspaces({
  workspaceId,
  isOwner,
  teamspaces,
}: {
  workspaceId: string;
  isOwner: boolean;
  /** The active teamspaces. */
  teamspaces: TeamspaceSummary[];
}) {
  const t = useTranslations("settings.teamspaces.defaults");
  const tc = useTranslations("common");
  const router = useRouter();
  const { pending, error, run } = useAction();
  const [confirm, setConfirm] = useState<{ teamspace: TeamspaceSummary; makeDefault: boolean } | null>(null);
  const defaults = teamspaces.filter((ts) => ts.access === "default");
  // Private ones stay out: making one default would show it to everyone.
  const candidates = teamspaces.filter((ts) => ts.access !== "default" && ts.access !== "private" && ts.canManage);

  return (
    <>
      <SettingsGroup title={t("heading")} description={t("description")}>
        {defaults.length ? (
          defaults.map((ts) => (
            <SettingsRow
              key={ts.id}
              title={
                <span className="flex min-w-0 items-center gap-2.5">
                  <TeamspaceName teamspace={ts} />
                </span>
              }
              control={
                isOwner ? (
                  <Button
                    size="sm"
                    disabled={pending}
                    aria-label={t("removeFor", { name: ts.name })}
                    onClick={() => setConfirm({ teamspace: ts, makeDefault: false })}
                  >
                    {t("remove")}
                  </Button>
                ) : undefined
              }
            />
          ))
        ) : (
          <p className="px-5 py-4 text-sm text-fg-muted">{t("empty")}</p>
        )}
        {isOwner && candidates.length > 0 && (
          <SettingsRow
            title={t("add")}
            htmlFor="add-default-teamspace"
            control={
              <select
                id="add-default-teamspace"
                className={cn(selectClass, "w-full sm:w-56")}
                value=""
                disabled={pending}
                onChange={(e) => {
                  const picked = candidates.find((ts) => ts.id === e.target.value);
                  if (picked) setConfirm({ teamspace: picked, makeDefault: true });
                }}
              >
                <option value="">{t("addPlaceholder")}</option>
                {candidates.map((ts) => (
                  <option key={ts.id} value={ts.id}>
                    {ts.icon ? `${ts.icon} ${ts.name}` : ts.name}
                  </option>
                ))}
              </select>
            }
          />
        )}
        {error && !confirm && <p className="px-5 py-3 text-xs text-danger">{error}</p>}
      </SettingsGroup>
      {/* Outside the group's card, whose dividers would draw on the overlay. */}
      <Dialog open={confirm !== null} onClose={() => setConfirm(null)} className="max-w-md">
        {confirm && (
          <div className="space-y-3 p-5">
            <h2 className="text-base font-semibold">
              {confirm.makeDefault
                ? t("makeTitle", { name: confirm.teamspace.name })
                : t("removeTitle", { name: confirm.teamspace.name })}
            </h2>
            <p className="text-sm text-fg-muted">{confirm.makeDefault ? t("makeBody") : t("removeBody")}</p>
            {error && <p className="text-xs text-danger">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setConfirm(null)}>
                {tc("cancel")}
              </Button>
              <Button
                variant="primary"
                disabled={pending}
                onClick={() =>
                  run(
                    () =>
                      updateTeamspaceAction(workspaceId, confirm.teamspace.id, {
                        access: confirm.makeDefault ? "default" : "open",
                      }),
                    () => {
                      setConfirm(null);
                      router.refresh();
                    },
                  )
                }
              >
                {confirm.makeDefault ? t("makeConfirm") : t("removeConfirm")}
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </>
  );
}

/** Who may create teamspaces. Owners change it; members see what is set. */
function CreationSetting({
  workspaceId,
  value: initial,
  canEdit,
}: {
  workspaceId: string;
  value: "owners" | "members";
  canEdit: boolean;
}) {
  const t = useTranslations("settings.teamspaces.creation");
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const { pending, error, run } = useAction();

  return (
    <SettingsRow
      title={t("title")}
      description={
        error ? (
          <span className="text-danger">{error}</span>
        ) : (
          <>
            {t("description")}
            {!canEdit && <> {t("ownersOnly")}</>}
          </>
        )
      }
      control={
        <Switch
          checked={value === "owners"}
          label={t("title")}
          disabled={!canEdit || pending}
          onChange={(ownersOnly) => {
            const next = ownersOnly ? "owners" : "members";
            const previous = value;
            setValue(next);
            run(async () => {
              const result = await updateWorkspaceSettingsAction(workspaceId, { teamspaceCreation: next });
              if (!result.ok) setValue(previous);
              else router.refresh();
              return result;
            });
          }}
        />
      }
    />
  );
}

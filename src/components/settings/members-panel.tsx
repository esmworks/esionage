"use client";

import { ArrowDown, ArrowUp, Download, MoreHorizontal, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import {
  addMembersAction,
  removeMemberAction,
  revokeInvitationAction,
  setJoinLinkAction,
  setMemberRoleAction,
  transferOwnershipAction,
} from "@/app/actions/workspaces";
import { CopyButton } from "@/components/settings/copy-button";
import { SettingsGroup, SettingsHeader, SettingsRow } from "@/components/settings/section";
import { selectClass, useAction } from "@/components/settings/workspace-settings";
import { Floating, useFloating } from "@/components/database/floating";
import { Button, cn, Dialog, IconButton, Input, MenuItem, Switch } from "@/components/ui";
import type { WorkspaceRole } from "@/db/schema/app";
import { MAX_BULK_EMAILS, parseEmailList } from "@/lib/emails";
import type { BulkAddResult } from "@/server/workspaces";

export type Member = {
  userId: string;
  name: string;
  email: string;
  role: WorkspaceRole;
  joinedAt: Date;
  lastEditedAt: Date | null;
};
export type Invitation = { id: string; email: string; role: WorkspaceRole; expiresAt: Date; link: string };

type SortKey = "name" | "role" | "joined" | "edited";
type Sort = { key: SortKey; dir: "asc" | "desc" };

function matches(query: string, ...values: string[]) {
  const q = query.trim().toLocaleLowerCase();
  return !q || values.some((v) => v.toLocaleLowerCase().includes(q));
}

function compareMembers(a: Member, b: Member, key: SortKey) {
  switch (key) {
    case "name":
      return (a.name || a.email).localeCompare(b.name || b.email);
    case "role":
      // Owners first when ascending.
      return (a.role === "owner" ? 0 : 1) - (b.role === "owner" ? 0 : 1) || a.name.localeCompare(b.name);
    case "joined":
      return a.joinedAt.getTime() - b.joinedAt.getTime();
    case "edited":
      // Never edited sorts as oldest.
      return (a.lastEditedAt?.getTime() ?? 0) - (b.lastEditedAt?.getTime() ?? 0);
  }
}

export function MembersPanel({
  workspaceId,
  currentUserId,
  isOwner,
  members,
  invitations,
  joinLink,
  now,
}: {
  workspaceId: string;
  currentUserId: string;
  isOwner: boolean;
  /** Render time from the server, so relative dates match between server and client render. */
  now: Date;
  members: Member[];
  /** Pending invitations; only owners get them. */
  invitations: Invitation[];
  /** The join link, or null when off. Only owners get it. */
  joinLink: string | null;
}) {
  const t = useTranslations("settings.members");
  const [tab, setTab] = useState<"members" | "invitations">("members");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>({ key: "name", dir: "asc" });
  const [adding, setAdding] = useState(false);

  const shownMembers = useMemo(() => {
    const list = members.filter((m) => matches(query, m.name, m.email));
    list.sort((a, b) => compareMembers(a, b, sort.key) * (sort.dir === "asc" ? 1 : -1));
    return list;
  }, [members, query, sort]);
  const shownInvitations = invitations.filter((i) => matches(query, i.email));

  return (
    <div>
      <SettingsHeader title={t("heading")} description={t("description")} />

      <div className="space-y-10">
        {isOwner && (
          <SettingsGroup>
            <JoinLinkCard workspaceId={workspaceId} link={joinLink} />
          </SettingsGroup>
        )}

        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div role="tablist" aria-label={t("heading")} className="inline-flex gap-0.5 rounded-lg bg-bg-hover p-0.5">
              <TabButton active={tab === "members"} onClick={() => setTab("members")}>
                {t("tabs.members")} <span className="text-fg-faint">{members.length}</span>
              </TabButton>
              {isOwner && (
                <TabButton active={tab === "invitations"} onClick={() => setTab("invitations")}>
                  {t("tabs.invitations")} <span className="text-fg-faint">{invitations.length}</span>
                </TabButton>
              )}
            </div>
            <div className="ml-auto flex items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-2 h-3.5 w-3.5 -translate-y-1/2 text-fg-faint" />
                <Input
                  type="search"
                  aria-label={t("search")}
                  placeholder={t("search")}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="w-44 pl-7 sm:w-56"
                />
              </div>
              {isOwner && (
                <a
                  href={`/w/${workspaceId}/settings/members.csv`}
                  download
                  aria-label={t("exportCsv")}
                  title={t("exportCsv")}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md text-fg-muted hover:bg-bg-hover hover:text-fg"
                >
                  <Download className="h-4 w-4" />
                </a>
              )}
              {isOwner && (
                <Button variant="primary" onClick={() => setAdding(true)}>
                  {t("addButton")}
                </Button>
              )}
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-border">
            {tab === "members" ? (
              <MembersTable
                now={now}
                workspaceId={workspaceId}
                currentUserId={currentUserId}
                isOwner={isOwner}
                members={shownMembers}
                sort={sort}
                onSort={(key) =>
                  setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "edited" ? "desc" : "asc" }))
                }
                empty={members.length ? t("noMatches") : null}
              />
            ) : (
              <InvitationsTable
                now={now}
                workspaceId={workspaceId}
                invitations={shownInvitations}
                empty={invitations.length ? t("noMatches") : t("noInvitations")}
              />
            )}
          </div>
        </div>
      </div>

      {isOwner && <AddMembersDialog workspaceId={workspaceId} open={adding} onClose={() => setAdding(false)} />}
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

function JoinLinkCard({ workspaceId, link }: { workspaceId: string; link: string | null }) {
  const t = useTranslations("settings.members.joinLink");
  const tc = useTranslations("common");
  const { pending, error, run } = useAction();
  const [confirmReset, setConfirmReset] = useState(false);

  return (
    <>
      <SettingsRow
        title={t("heading")}
        description={
          <>
            {link ? t("descriptionOn") : t("descriptionOff")}{" "}
            {link && (
              <button
                type="button"
                className="underline underline-offset-2 hover:text-fg"
                disabled={pending}
                onClick={() => setConfirmReset(true)}
              >
                {t("regenerate")}
              </button>
            )}
            {error && <span className="mt-1 block text-danger">{error}</span>}
          </>
        }
        control={
          <>
            {link && <CopyButton value={link} label={t("copy")} />}
            <Switch
              checked={Boolean(link)}
              disabled={pending}
              label={t("toggle")}
              onChange={(on) => run(() => setJoinLinkAction(workspaceId, on ? "enable" : "disable"))}
            />
          </>
        }
      />
      <Dialog open={confirmReset} onClose={() => setConfirmReset(false)} className="max-w-md">
        <div className="space-y-3 p-5">
          <h2 className="text-base font-semibold">{t("regenerateTitle")}</h2>
          <p className="text-sm text-fg-muted">{t("regenerateBody")}</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmReset(false)}>
              {tc("cancel")}
            </Button>
            <Button
              variant="primary"
              disabled={pending}
              onClick={() => run(() => setJoinLinkAction(workspaceId, "regenerate"), () => setConfirmReset(false))}
            >
              {t("regenerateConfirm")}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}

function SortHeader({
  label,
  column,
  sort,
  onSort,
  className,
}: {
  label: string;
  column: SortKey;
  sort: Sort;
  onSort: (key: SortKey) => void;
  className?: string;
}) {
  const active = sort.key === column;
  const Arrow = sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th
      scope="col"
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
      className={cn("px-4 py-2.5 text-left font-normal", className)}
    >
      <button type="button" onClick={() => onSort(column)} className="inline-flex items-center gap-1 hover:text-fg">
        {label}
        {active && <Arrow className="h-3 w-3" />}
      </button>
    </th>
  );
}

function MembersTable({
  now,
  workspaceId,
  currentUserId,
  isOwner,
  members,
  sort,
  onSort,
  empty,
}: {
  now: Date;
  workspaceId: string;
  currentUserId: string;
  isOwner: boolean;
  members: Member[];
  sort: Sort;
  onSort: (key: SortKey) => void;
  empty: string | null;
}) {
  const t = useTranslations("settings.members");
  if (!members.length) return empty ? <p className="px-4 py-8 text-center text-sm text-fg-muted">{empty}</p> : null;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="border-b border-border bg-bg-subtle text-xs text-fg-muted">
          <tr>
            <SortHeader label={t("columns.user")} column="name" sort={sort} onSort={onSort} />
            <SortHeader label={t("columns.role")} column="role" sort={sort} onSort={onSort} className="w-36" />
            <SortHeader label={t("columns.joined")} column="joined" sort={sort} onSort={onSort} className="w-32" />
            <SortHeader label={t("columns.lastEdited")} column="edited" sort={sort} onSort={onSort} className="w-40" />
            <th scope="col" className="w-10">
              <span className="sr-only">{t("columns.actions")}</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {members.map((m) => (
            <MemberRow
              key={m.userId}
              now={now}
              workspaceId={workspaceId}
              member={m}
              isSelf={m.userId === currentUserId}
              isOwner={isOwner}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Avatar({ name }: { name: string }) {
  const initial = (name.trim()[0] ?? "?").toLocaleUpperCase();
  return (
    <span
      aria-hidden
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-bg-active text-xs font-medium text-fg-muted"
    >
      {initial}
    </span>
  );
}

type PendingConfirm = "remove" | "transfer" | null;

function MemberRow({
  now,
  workspaceId,
  member,
  isSelf,
  isOwner,
}: {
  now: Date;
  workspaceId: string;
  member: Member;
  isSelf: boolean;
  isOwner: boolean;
}) {
  const router = useRouter();
  const t = useTranslations("settings.members");
  const tc = useTranslations("common");
  const format = useFormatter();
  const [confirm, setConfirm] = useState<PendingConfirm>(null);
  const menu = useFloating<HTMLButtonElement>();
  const { pending, error, run } = useAction();
  const canRemove = isOwner || isSelf;
  const canTransfer = isOwner && !isSelf && member.role !== "owner";

  return (
    <tr className="align-middle">
      <td className="px-4 py-3">
        <div className="flex items-center gap-2.5">
          <Avatar name={member.name || member.email} />
          <div className="min-w-0">
            <div className="truncate font-medium">
              {member.name}
              {isSelf && <span className="font-normal text-fg-muted"> {t("you")}</span>}
            </div>
            <div className="truncate text-xs text-fg-muted">{member.email}</div>
          </div>
        </div>
        {error && <p className="mt-1 text-xs text-danger">{error}</p>}
      </td>
      <td className="px-4 py-3">
        {isOwner ? (
          <select
            aria-label={t("roleOf", { name: member.name })}
            className={selectClass}
            value={member.role}
            disabled={pending}
            onChange={(e) => run(() => setMemberRoleAction(workspaceId, member.userId, e.target.value as WorkspaceRole))}
          >
            <option value="owner">{t("roles.owner")}</option>
            <option value="member">{t("roles.member")}</option>
            <option value="guest">{t("roles.guest")}</option>
          </select>
        ) : (
          <span className="text-fg-muted">{t(`roles.${member.role}`)}</span>
        )}
      </td>
      <td className="px-4 py-3 whitespace-nowrap text-fg-muted">{format.dateTime(member.joinedAt, { dateStyle: "medium" })}</td>
      <td className="px-4 py-3 whitespace-nowrap text-fg-muted">
        {member.lastEditedAt ? (
          <time dateTime={member.lastEditedAt.toISOString()} title={format.dateTime(member.lastEditedAt, { dateStyle: "medium", timeStyle: "short" })}>
            {format.relativeTime(member.lastEditedAt, now)}
          </time>
        ) : (
          <span className="text-fg-faint">{t("neverEdited")}</span>
        )}
      </td>
      <td className="px-1 py-2.5 text-right">
        {(canRemove || canTransfer) && (
          <>
            <IconButton
              ref={menu.ref}
              label={t("actionsFor", { name: member.name })}
              onClick={menu.toggle}
              disabled={pending}
            >
              <MoreHorizontal className="h-4 w-4" />
            </IconButton>
            {/* Portaled so the table's scroll container doesn't clip it. */}
            <Floating anchor={menu.el} open={menu.open} onClose={menu.close} align="end" className="text-left">
              {canTransfer && (
                <MenuItem
                  onClick={() => {
                    menu.close();
                    setConfirm("transfer");
                  }}
                >
                  {t("transfer")}
                </MenuItem>
              )}
              {canRemove && (
                <MenuItem
                  danger
                  onClick={() => {
                    menu.close();
                    setConfirm("remove");
                  }}
                >
                  {isSelf ? t("leave") : tc("remove")}
                </MenuItem>
              )}
            </Floating>
          </>
        )}
        <Dialog open={confirm !== null} onClose={() => setConfirm(null)} className="max-w-md text-left">
          <div className="space-y-3 p-5">
            <h2 className="text-base font-semibold">
              {confirm === "transfer"
                ? t("transferTitle", { name: member.name })
                : isSelf
                  ? t("leaveTitle")
                  : t("removeTitle", { name: member.name })}
            </h2>
            <p className="text-sm text-fg-muted">
              {confirm === "transfer" ? t("transferBody", { name: member.name }) : isSelf ? t("leaveBody") : t("removeBody", { name: member.name })}
            </p>
            {error && <p className="text-xs text-danger">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setConfirm(null)}>
                {tc("cancel")}
              </Button>
              <Button
                variant={confirm === "transfer" ? "primary" : "danger"}
                disabled={pending}
                onClick={() =>
                  confirm === "transfer"
                    ? run(() => transferOwnershipAction(workspaceId, member.userId), () => setConfirm(null))
                    : run(
                        () => removeMemberAction(workspaceId, member.userId),
                        () => {
                          setConfirm(null);
                          if (isSelf) {
                            router.push("/");
                            router.refresh();
                          }
                        },
                      )
                }
              >
                {confirm === "transfer" ? t("transferConfirm") : isSelf ? t("leave") : tc("remove")}
              </Button>
            </div>
          </div>
        </Dialog>
      </td>
    </tr>
  );
}

function InvitationsTable({
  now,
  workspaceId,
  invitations,
  empty,
}: {
  now: Date;
  workspaceId: string;
  invitations: Invitation[];
  empty: string;
}) {
  const t = useTranslations("settings.members");
  if (!invitations.length) return <p className="px-4 py-8 text-center text-sm text-fg-muted">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="border-b border-border bg-bg-subtle text-xs text-fg-muted">
          <tr>
            <th scope="col" className="px-4 py-2.5 text-left font-normal">
              {t("columns.email")}
            </th>
            <th scope="col" className="w-36 px-4 py-2.5 text-left font-normal">
              {t("columns.role")}
            </th>
            <th scope="col" className="w-48 px-4 py-2.5 text-left font-normal">
              {t("columns.status")}
            </th>
            <th scope="col" className="w-64">
              <span className="sr-only">{t("columns.actions")}</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {invitations.map((invitation) => (
            <InvitationRow key={invitation.id} now={now} workspaceId={workspaceId} invitation={invitation} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function InvitationRow({ now, workspaceId, invitation }: { now: Date; workspaceId: string; invitation: Invitation }) {
  const t = useTranslations("settings.members");
  const format = useFormatter();
  const { pending, error, run } = useAction();
  const expired = invitation.expiresAt.getTime() <= now.getTime();

  return (
    <tr>
      <td className="px-4 py-3">
        <div className="truncate font-medium">{invitation.email}</div>
        {error && <p className="mt-1 text-xs text-danger">{error}</p>}
      </td>
      <td className="px-4 py-3 text-fg-muted">{t(`roles.${invitation.role}`)}</td>
      <td className={cn("px-4 py-3", expired ? "text-danger" : "text-fg-muted")}>
        {expired ? t("expired") : t("expires", { date: format.dateTime(invitation.expiresAt, { dateStyle: "medium" }) })}
      </td>
      <td className="px-4 py-3">
        <div className="flex justify-end gap-2">
          {!expired && <CopyButton value={invitation.link} label={t("copyLink")} />}
          <Button
            size="sm"
            className="whitespace-nowrap"
            disabled={pending}
            onClick={() => run(() => revokeInvitationAction(workspaceId, invitation.id))}
          >
            {t("cancelInvitation")}
          </Button>
        </div>
      </td>
    </tr>
  );
}

function AddMembersDialog({ workspaceId, open, onClose }: { workspaceId: string; open: boolean; onClose: () => void }) {
  const t = useTranslations("settings.members");
  const tc = useTranslations("common");
  const tErrors = useTranslations("settings.errors");
  const [text, setText] = useState("");
  const [role, setRole] = useState<WorkspaceRole>("member");
  const [results, setResults] = useState<BulkAddResult[] | null>(null);
  const { pending, error, run } = useAction();
  const count = parseEmailList(text).length;
  const tooMany = count > MAX_BULK_EMAILS;

  function close() {
    setText("");
    setRole("member");
    setResults(null);
    onClose();
  }

  return (
    <Dialog open={open} onClose={close} className="max-w-lg">
      {results ? (
        <div className="space-y-3 p-5">
          <h2 className="text-base font-semibold">{t("add.resultsTitle")}</h2>
          <ul className="max-h-80 divide-y divide-border overflow-y-auto rounded-md border border-border">
            {results.map((r) => (
              <li key={r.email} className="space-y-1.5 px-3 py-2 text-sm">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate font-medium">{r.email}</span>
                  <span className={cn("shrink-0 text-xs", r.kind === "error" ? "text-danger" : "text-fg-muted")}>
                    {r.kind === "added"
                      ? t("add.added")
                      : r.kind === "invited"
                        ? t(r.delivery === "sent" ? "add.emailed" : r.delivery === "failed" ? "add.emailFailed" : "add.linkOnly")
                        : tErrors(r.code)}
                  </span>
                </div>
                {r.kind === "invited" && r.delivery !== "sent" && (
                  <div className="flex items-center gap-2">
                    <Input readOnly value={r.link} onFocus={(e) => e.currentTarget.select()} aria-label={t("inviteLink")} />
                    <CopyButton value={r.link} label={t("copyLink")} />
                  </div>
                )}
              </li>
            ))}
          </ul>
          <p className="text-xs text-fg-muted">{t("add.linkValidity")}</p>
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                setText("");
                setResults(null);
              }}
            >
              {t("add.addMore")}
            </Button>
            <Button variant="primary" onClick={close}>
              {tc("close")}
            </Button>
          </div>
        </div>
      ) : (
        <form
          className="space-y-3 p-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (!count || tooMany) return;
            run(() => addMembersAction(workspaceId, parseEmailList(text), role), setResults);
          }}
        >
          <h2 className="text-base font-semibold">{t("add.title")}</h2>
          <p className="text-sm text-fg-muted">{t("add.description")}</p>
          <label className="block space-y-1.5">
            <span className="text-sm text-fg-muted">{t("add.emailsLabel")}</span>
            <textarea
              autoFocus
              rows={4}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t("add.emailsPlaceholder")}
              className="w-full resize-y rounded-md border border-border bg-bg px-2.5 py-2 text-sm outline-none placeholder:text-fg-faint focus:border-accent"
            />
          </label>
          <div className="flex items-center justify-between gap-3">
            <span className={cn("text-xs", tooMany ? "text-danger" : "text-fg-muted")}>
              {tooMany ? tErrors("tooManyEmails") : t("add.count", { count })}
            </span>
            <label className="flex items-center gap-2 text-sm text-fg-muted">
              {t("roleLabel")}
              <select className={selectClass} value={role} onChange={(e) => setRole(e.target.value as WorkspaceRole)}>
                <option value="member">{t("roles.member")}</option>
                <option value="owner">{t("roles.owner")}</option>
                <option value="guest">{t("roles.guest")}</option>
              </select>
            </label>
          </div>
          {error && <p className="text-xs text-danger">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={close}>
              {tc("cancel")}
            </Button>
            <Button type="submit" variant="primary" disabled={pending || !count || tooMany}>
              {pending ? t("add.submitting") : t("add.submit")}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import {
  addMemberAction,
  removeMemberAction,
  renameWorkspaceAction,
  setMemberRoleAction,
  type ActionResult,
} from "@/app/actions/workspaces";
import { Button, Input } from "@/components/ui";
import type { WorkspaceRole } from "@/db/schema/app";

type Member = { userId: string; name: string; email: string; role: WorkspaceRole };

function useAction() {
  const tc = useTranslations("common");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  function run<T>(action: () => Promise<ActionResult<T>>, onOk?: (data: T) => void) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await action();
        if (result.ok) onOk?.(result.data);
        else setError(result.error);
      } catch {
        setError(tc("genericError"));
      }
    });
  }
  return { pending, error, run };
}

export const selectClass =
  "h-8 rounded-md border border-border bg-bg px-2 text-sm outline-none focus:border-accent disabled:opacity-60";

export function WorkspaceNameForm({ workspaceId, name, canEdit }: { workspaceId: string; name: string; canEdit: boolean }) {
  const t = useTranslations("settings.workspace");
  const tc = useTranslations("common");
  const [value, setValue] = useState(name);
  const [saved, setSaved] = useState(false);
  const { pending, error, run } = useAction();
  const dirty = value.trim() !== name && value.trim() !== "";

  return (
    <form
      className="space-y-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!dirty) return;
        setSaved(false);
        run(() => renameWorkspaceAction(workspaceId, value), () => setSaved(true));
      }}
    >
      <label htmlFor="workspace-name" className="text-sm text-fg-muted">
        {t("nameLabel")}
      </label>
      <div className="flex gap-2">
        <Input
          id="workspace-name"
          value={value}
          maxLength={80}
          disabled={!canEdit}
          onChange={(e) => {
            setValue(e.target.value);
            setSaved(false);
          }}
        />
        {canEdit && (
          <Button type="submit" variant="primary" disabled={!dirty || pending}>
            {pending ? tc("saving") : tc("save")}
          </Button>
        )}
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
      {saved && !error && <p className="text-xs text-fg-muted">{tc("saved")}</p>}
      {!canEdit && <p className="text-xs text-fg-muted">{t("ownersOnly")}</p>}
    </form>
  );
}

export function MembersSection({
  workspaceId,
  currentUserId,
  isOwner,
  members,
}: {
  workspaceId: string;
  currentUserId: string;
  isOwner: boolean;
  members: Member[];
}) {
  const t = useTranslations("settings.members");
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold">{t("heading")}</h2>
        <p className="mt-1 text-sm text-fg-muted">
          {t("description")}
        </p>
      </div>
      <ul className="divide-y divide-border rounded-md border border-border">
        {members.map((m) => (
          <MemberRow key={m.userId} workspaceId={workspaceId} member={m} isSelf={m.userId === currentUserId} isOwner={isOwner} />
        ))}
      </ul>
      {isOwner && <AddMemberForm workspaceId={workspaceId} />}
    </section>
  );
}

function MemberRow({
  workspaceId,
  member,
  isSelf,
  isOwner,
}: {
  workspaceId: string;
  member: Member;
  isSelf: boolean;
  isOwner: boolean;
}) {
  const router = useRouter();
  const t = useTranslations("settings.members");
  const tc = useTranslations("common");
  const [confirming, setConfirming] = useState(false);
  const { pending, error, run } = useAction();
  const canRemove = isOwner || isSelf;

  return (
    <li className="px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">
            {member.name}
            {isSelf && <span className="font-normal text-fg-muted"> {t("you")}</span>}
          </div>
          <div className="truncate text-xs text-fg-muted">{member.email}</div>
        </div>
        <select
          aria-label={t("roleOf", { name: member.name })}
          className={selectClass}
          value={member.role}
          disabled={!isOwner || pending}
          onChange={(e) => run(() => setMemberRoleAction(workspaceId, member.userId, e.target.value as WorkspaceRole))}
        >
          <option value="owner">{t("roles.owner")}</option>
          <option value="member">{t("roles.member")}</option>
        </select>
        {canRemove &&
          (confirming ? (
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => setConfirming(false)}>
                {tc("cancel")}
              </Button>
              <Button
                size="sm"
                variant="danger"
                disabled={pending}
                onClick={() =>
                  run(
                    () => removeMemberAction(workspaceId, member.userId),
                    () => {
                      setConfirming(false);
                      if (isSelf) {
                        router.push("/");
                        router.refresh();
                      }
                    },
                  )
                }
              >
                {isSelf ? t("leave") : tc("remove")}
              </Button>
            </div>
          ) : (
            <Button size="sm" onClick={() => setConfirming(true)}>
              {isSelf ? t("leave") : tc("remove")}
            </Button>
          ))}
      </div>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </li>
  );
}

function AddMemberForm({ workspaceId }: { workspaceId: string }) {
  const t = useTranslations("settings.members");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<WorkspaceRole>("member");
  const { pending, error, run } = useAction();

  return (
    <form
      className="space-y-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!email.trim()) return;
        run(() => addMemberAction(workspaceId, email, role), () => setEmail(""));
      }}
    >
      <label htmlFor="member-email" className="text-sm text-fg-muted">
        {t("addLabel")}
      </label>
      <div className="flex gap-2">
        <Input
          id="member-email"
          type="email"
          placeholder={t("emailPlaceholder")}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <select
          aria-label={t("roleLabel")}
          className={selectClass}
          value={role}
          onChange={(e) => setRole(e.target.value as WorkspaceRole)}
        >
          <option value="member">{t("roles.member")}</option>
          <option value="owner">{t("roles.owner")}</option>
        </select>
        <Button type="submit" variant="primary" disabled={pending || !email.trim()}>
          {pending ? t("adding") : t("addButton")}
        </Button>
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
    </form>
  );
}

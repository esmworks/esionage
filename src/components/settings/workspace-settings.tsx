"use client";

import { useRouter } from "next/navigation";
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
        setError("Something went wrong. Try again.");
      }
    });
  }
  return { pending, error, run };
}

const selectClass =
  "h-8 rounded-md border border-border bg-bg px-2 text-sm outline-none focus:border-accent disabled:opacity-60";

export function WorkspaceNameForm({ workspaceId, name, canEdit }: { workspaceId: string; name: string; canEdit: boolean }) {
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
        Name
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
            {pending ? "Saving…" : "Save"}
          </Button>
        )}
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
      {saved && !error && <p className="text-xs text-fg-muted">Saved.</p>}
      {!canEdit && <p className="text-xs text-fg-muted">Only owners can rename the workspace.</p>}
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
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold">Members</h2>
        <p className="mt-1 text-sm text-fg-muted">
          Everyone here can read and edit every page in this workspace. Owners can also manage members.
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
  const [confirming, setConfirming] = useState(false);
  const { pending, error, run } = useAction();
  const canRemove = isOwner || isSelf;

  return (
    <li className="px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">
            {member.name}
            {isSelf && <span className="font-normal text-fg-muted"> (you)</span>}
          </div>
          <div className="truncate text-xs text-fg-muted">{member.email}</div>
        </div>
        <select
          aria-label={`Role of ${member.name}`}
          className={selectClass}
          value={member.role}
          disabled={!isOwner || pending}
          onChange={(e) => run(() => setMemberRoleAction(workspaceId, member.userId, e.target.value as WorkspaceRole))}
        >
          <option value="owner">Owner</option>
          <option value="member">Member</option>
        </select>
        {canRemove &&
          (confirming ? (
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => setConfirming(false)}>
                Cancel
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
                {isSelf ? "Leave" : "Remove"}
              </Button>
            </div>
          ) : (
            <Button size="sm" onClick={() => setConfirming(true)}>
              {isSelf ? "Leave" : "Remove"}
            </Button>
          ))}
      </div>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </li>
  );
}

function AddMemberForm({ workspaceId }: { workspaceId: string }) {
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
        Add a member by the email they signed up with
      </label>
      <div className="flex gap-2">
        <Input
          id="member-email"
          type="email"
          placeholder="name@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <select aria-label="Role" className={selectClass} value={role} onChange={(e) => setRole(e.target.value as WorkspaceRole)}>
          <option value="member">Member</option>
          <option value="owner">Owner</option>
        </select>
        <Button type="submit" variant="primary" disabled={pending || !email.trim()}>
          {pending ? "Adding…" : "Add"}
        </Button>
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
    </form>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createWorkspaceAction } from "@/app/actions/workspaces";
import { Button, Dialog, Input } from "@/components/ui";

export function NewWorkspaceDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function close() {
    setName("");
    setError(null);
    onClose();
  }

  return (
    <Dialog open={open} onClose={close} className="max-w-md">
      <form
        className="space-y-3 p-5"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          startTransition(async () => {
            const result = await createWorkspaceAction(name);
            if (!result.ok) return setError(result.error);
            close();
            router.push(`/w/${result.data}`);
          });
        }}
      >
        <h2 className="text-base font-semibold">New workspace</h2>
        <p className="text-sm text-fg-muted">A separate space with its own pages and members.</p>
        <Input autoFocus placeholder="Workspace name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        {error && <p className="text-xs text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={pending || !name.trim()}>
            {pending ? "Creating…" : "Create"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

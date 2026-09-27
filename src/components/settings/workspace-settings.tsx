"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { renameWorkspaceAction, type ActionResult } from "@/app/actions/workspaces";
import { Button, Input } from "@/components/ui";

export function useAction() {
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

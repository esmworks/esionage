"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { revokeConnectedAppAction } from "@/app/actions/oauth";
import { Button } from "@/components/ui";

export function RevokeAppButton({ clientId, name }: { clientId: string; name: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!confirming) {
    return (
      <Button size="sm" onClick={() => setConfirming(true)}>
        Revoke
      </Button>
    );
  }

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <div className="flex gap-1">
        <Button size="sm" variant="ghost" onClick={() => setConfirming(false)} disabled={pending}>
          Cancel
        </Button>
        <Button
          size="sm"
          variant="danger"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              try {
                await revokeConnectedAppAction(clientId);
                router.refresh();
              } catch {
                setError("Could not revoke access. Try again.");
              }
            })
          }
        >
          {pending ? "Revoking…" : `Disconnect ${name}`}
        </Button>
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

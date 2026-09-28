"use client";

import { UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { listInboxAction, markReadAction } from "@/app/actions/notifications";
import { Button, cn, Dialog, PageIcon, pageLabel } from "@/components/ui";
import { formatIsoDate } from "@/lib/mentions";
import { relativeTime } from "@/lib/relative-time";
import type { InboxItem } from "@/server/notifications";

/**
 * The workspace inbox: rows the user was assigned to, pages shared with them, comments, mentions,
 * reminders and, for owners, join requests, newest first; opening one marks it read.
 */
export function InboxDialog({
  workspaceId,
  open,
  onClose,
  version,
  onRead,
}: {
  workspaceId: string;
  open: boolean;
  onClose: () => void;
  /** Bumped when the inbox changed elsewhere, so an open dialog reloads. */
  version: number;
  /** Called after notifications were marked read, so the unread count updates. */
  onRead: () => void;
}) {
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations("sidebar.inbox");
  const tc = useTranslations("common");
  const [items, setItems] = useState<InboxItem[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!open) return;
    let current = true;
    setError(false);
    listInboxAction(workspaceId).then(
      (list) => current && setItems(list),
      () => current && setError(true),
    );
    return () => {
      current = false;
    };
  }, [open, workspaceId, version]);

  const markRead = async (ids?: string[]) => {
    setItems((list) => list?.map((item) => (!ids || ids.includes(item.id) ? { ...item, read: true } : item)) ?? list);
    try {
      await markReadAction(workspaceId, ids);
    } catch {
      setError(true);
    }
    onRead();
  };

  const unread = items?.filter((item) => !item.read) ?? [];

  return (
    <Dialog open={open} onClose={onClose}>
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <span className="flex-1 text-sm font-medium">{t("title")}</span>
        {unread.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => void markRead()}>
            {t("markAllRead")}
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="border-b border-border px-4 py-2 text-xs text-danger">
          {tc("genericError")}
        </p>
      )}
      <ul className="max-h-[60vh] overflow-y-auto p-1">
        {items?.length === 0 && <li className="px-3 py-6 text-center text-sm text-fg-muted">{t("empty")}</li>}
        {items?.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              className="flex w-full items-start gap-2.5 rounded-md px-3 py-2 text-left hover:bg-bg-hover"
              onClick={() => {
                if (!item.read) void markRead([item.id]);
                onClose();
                // Join requests are decided in Settings > Members.
                router.push(
                  item.pageId === null ? `/w/${workspaceId}/settings?tab=members&view=requests` : `/w/${workspaceId}/p/${item.pageId}`,
                );
              }}
            >
              <span
                aria-hidden
                className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", item.read ? "bg-transparent" : "bg-accent")}
              />
              <span className="min-w-0 flex-1">
                <span className={cn("flex items-center gap-1.5 text-sm", !item.read && "font-medium")}>
                  {item.pageId === null ? (
                    <>
                      <UserPlus aria-hidden className="h-3.5 w-3.5 shrink-0 text-fg-muted" />
                      <span className="truncate">{t("joinRequestTitle")}</span>
                    </>
                  ) : (
                    <>
                      <PageIcon icon={item.pageIcon} kind="page" className="text-sm" />
                      <span className="truncate">{pageLabel(item.pageTitle ?? "", tc("untitled"))}</span>
                    </>
                  )}
                </span>
                <span className="mt-0.5 block text-xs text-fg-muted">
                  {item.kind === "join_request"
                    ? item.requestKind === "invite"
                      ? t("inviteRequest", { actor: item.actorName || t("someone"), email: item.requestEmail ?? "" })
                      : t("joinRequest", { actor: item.actorName || t("someone") })
                    : item.kind === "page_shared"
                    ? t("pageShared", { actor: item.actorName || t("someone") })
                    : item.kind === "comment"
                      ? t("comment", { actor: item.actorName || t("someone") })
                      : item.kind === "mention"
                        ? t("mention", { actor: item.actorName || t("someone") })
                        : item.kind === "reminder"
                          ? t("reminder", { date: item.reminderDate ? formatIsoDate(item.reminderDate, locale) : "" })
                          : t("assignment", { actor: item.actorName || t("someone"), property: item.propertyName ?? "" })}
                  {item.databaseTitle !== null && <> · {pageLabel(item.databaseTitle, tc("untitled"))}</>}
                </span>
              </span>
              <time
                dateTime={new Date(item.createdAt).toISOString()}
                className="shrink-0 pt-0.5 text-xs text-fg-faint"
                title={new Date(item.createdAt).toLocaleString(locale)}
              >
                {relativeTime(item.createdAt, locale)}
              </time>
              {!item.read && <span className="sr-only">{t("unread")}</span>}
            </button>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}

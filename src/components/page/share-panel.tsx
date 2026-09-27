"use client";

import { Check, Link2, Search, Users, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  getSharingAction,
  removePagePermissionAction,
  setPagePermissionAction,
  type SharingResult,
} from "@/app/actions/sharing";
import { cn } from "@/components/ui";
import type { PageLevel } from "@/db/schema";
import { PublishTab } from "./publish-tab";

type Sharing = Awaited<ReturnType<typeof getSharingAction>>;
type CurrentUser = { id: string; name: string; email?: string };

const LEVELS: PageLevel[] = ["full", "edit", "view", "none"];

/** The Share popover: who can open the page (Share) and the public web link (Publish). */
export function SharePanel({ pageId, currentUser }: { pageId: string; currentUser: CurrentUser }) {
  const t = useTranslations("page.share");
  const [tab, setTab] = useState<"share" | "publish">("share");
  return (
    <div className="w-[min(28rem,calc(100vw-2rem))]">
      <div className="flex gap-4 border-b border-border px-3" role="tablist">
        {(["share", "publish"] as const).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={cn(
              "-mb-px border-b-2 py-2 text-sm",
              tab === key ? "border-fg font-medium text-fg" : "border-transparent text-fg-muted hover:text-fg",
            )}
          >
            {key === "share" ? t("tabShare") : t("tabPublish")}
          </button>
        ))}
      </div>
      {tab === "share" ? <ShareTab pageId={pageId} currentUser={currentUser} /> : <PublishTab pageId={pageId} />}
    </div>
  );
}

function ShareTab({ pageId, currentUser }: { pageId: string; currentUser: CurrentUser }) {
  const currentUserId = currentUser.id;
  const t = useTranslations("page.share");
  const [data, setData] = useState<Sharing | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await getSharingAction(pageId));
    } catch {
      setError(t("errors.generic"));
    }
  }, [pageId, t]);
  useEffect(() => {
    void load();
  }, [load]);

  const run = async (action: () => Promise<SharingResult>) => {
    setBusy(true);
    setError(null);
    const result = await action();
    if (!result.ok) setError(t(`errors.${result.code}`));
    await load();
    setBusy(false);
  };

  const canManage = data?.level === "full";
  const listed = useMemo(() => new Set(data?.entries.map((e) => e.userId)), [data]);
  const candidates = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    if (!data || !q) return [];
    return data.members
      .filter((m) => !listed.has(m.userId) && m.userId !== currentUserId)
      .filter((m) => m.name.toLocaleLowerCase().includes(q) || m.email.toLocaleLowerCase().includes(q))
      .slice(0, 6);
  }, [data, query, listed, currentUserId]);

  const copyLink = () => {
    void navigator.clipboard.writeText(window.location.href.split("?")[0]);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (!data) {
    return <div className="px-3 py-6 text-sm text-fg-muted">{error ?? t("loading")}</div>;
  }

  const self = data.members.find((m) => m.userId === currentUserId);
  const mine = data.entries.find((e) => e.userId === currentUserId);
  const myName = self?.name || currentUser.name;
  const others = data.entries.filter((e) => e.userId !== currentUserId);

  return (
    <div className={cn("p-3", busy && "pointer-events-none opacity-70")}>
      {canManage ? (
        <div className="relative">
          <label className="flex h-9 items-center gap-2 rounded-md border border-border px-2 focus-within:border-accent">
            <Search className="h-4 w-4 shrink-0 text-fg-faint" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("addPeople")}
              aria-label={t("addPeople")}
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-fg-faint"
            />
          </label>
          {query.trim() && (
            <div className="absolute inset-x-0 top-full z-10 mt-1 rounded-lg border border-border bg-bg p-1 shadow-lg">
              {candidates.map((m) => (
                <button
                  key={m.userId}
                  type="button"
                  onClick={() => {
                    setQuery("");
                    void run(() => setPagePermissionAction(pageId, m.userId, "edit"));
                  }}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-bg-hover"
                >
                  <Avatar name={m.name} />
                  <PersonLabel name={m.name} detail={m.email} />
                </button>
              ))}
              {!candidates.length && <p className="px-2 py-1.5 text-sm text-fg-muted">{t("noMatches")}</p>}
              <p className="border-t border-border px-2 pt-1.5 pb-1 text-xs text-fg-faint">{t("membersOnly")}</p>
            </div>
          )}
        </div>
      ) : (
        <p className="text-xs text-fg-muted">{t("readOnly")}</p>
      )}

      {error && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      )}

      <ul className="mt-3 space-y-0.5">
        <Row
          avatar={<Avatar name={myName} />}
          label={<PersonLabel name={`${myName} (${t("you")})`} detail={self?.email ?? currentUser.email} />}
          control={
            // Your own entry is how you keep full access while making the page private.
            canManage ? (
              <LevelSelect
                value={mine?.level ?? data.level}
                onChange={(level) => void run(() => setPagePermissionAction(pageId, currentUserId, level))}
                onRemove={
                  mine && !mine.inherited
                    ? () => void run(() => removePagePermissionAction(pageId, currentUserId))
                    : undefined
                }
              />
            ) : (
              <LevelText level={data.level} />
            )
          }
        />
        {others.map((entry) => (
          <Row
            key={entry.userId}
            avatar={<Avatar name={entry.name ?? "?"} />}
            label={
              <PersonLabel
                name={entry.name ?? entry.email ?? "?"}
                detail={entry.inherited ? t("inherited", { title: entry.sourceTitle || "…" }) : (entry.email ?? undefined)}
              />
            }
            control={
              canManage ? (
                <LevelSelect
                  value={entry.level}
                  onChange={(level) => void run(() => setPagePermissionAction(pageId, entry.userId, level))}
                  onRemove={
                    entry.inherited ? undefined : () => void run(() => removePagePermissionAction(pageId, entry.userId))
                  }
                />
              ) : (
                <LevelText level={entry.level} />
              )
            }
          />
        ))}
      </ul>

      <div className="mt-3 border-t border-border pt-3">
        <p className="mb-1 text-xs font-medium text-fg-muted">{t("generalAccess")}</p>
        <Row
          avatar={
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-bg-hover text-fg-muted">
              <Users className="h-4 w-4" />
            </span>
          }
          label={<PersonLabel name={t("everyone")} />}
          control={
            canManage ? (
              <LevelSelect
                value={data.everyone}
                onChange={(level) => void run(() => setPagePermissionAction(pageId, null, level))}
              />
            ) : (
              <LevelText level={data.everyone} />
            )
          }
        />
        <p className="mt-1 text-xs text-fg-faint">{t("everyoneHint")}</p>
      </div>

      <div className="mt-3 flex justify-end border-t border-border pt-3">
        <button
          type="button"
          onClick={copyLink}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-sm hover:bg-bg-hover"
        >
          {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Link2 className="h-4 w-4" />}
          {copied ? t("copied") : t("copyLink")}
        </button>
      </div>
    </div>
  );
}

function Row({ avatar, label, control }: { avatar: ReactNode; label: ReactNode; control: ReactNode }) {
  return (
    <li className="flex list-none items-center gap-2 py-1">
      {avatar}
      <div className="min-w-0 flex-1">{label}</div>
      <div className="shrink-0">{control}</div>
    </li>
  );
}

function PersonLabel({ name, detail }: { name: string; detail?: string | null }) {
  return (
    <div className="min-w-0">
      <div className="truncate text-sm">{name}</div>
      {detail && <div className="truncate text-xs text-fg-muted">{detail}</div>}
    </div>
  );
}

function Avatar({ name }: { name: string }) {
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/15 text-xs font-medium text-accent">
      {(name.trim()[0] ?? "?").toLocaleUpperCase()}
    </span>
  );
}

function LevelText({ level }: { level: PageLevel }) {
  const t = useTranslations("page.share.levels");
  return <span className="px-2 text-sm text-fg-muted">{t(level)}</span>;
}

function LevelSelect({
  value,
  onChange,
  onRemove,
}: {
  value: PageLevel;
  onChange: (level: PageLevel) => void;
  onRemove?: () => void;
}) {
  const t = useTranslations("page.share");
  return (
    <div className="flex items-center gap-0.5">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as PageLevel)}
        className="h-7 rounded-md bg-transparent px-1.5 text-sm text-fg-muted hover:bg-bg-hover focus:outline-none"
      >
        {LEVELS.map((level) => (
          <option key={level} value={level}>
            {t(`levels.${level}`)}
          </option>
        ))}
      </select>
      {onRemove && (
        <button
          type="button"
          aria-label={t("remove")}
          title={t("remove")}
          onClick={onRemove}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-fg-muted hover:bg-bg-hover hover:text-danger"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

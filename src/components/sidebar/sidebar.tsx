"use client";

import {
  ChevronDown,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Database,
  FileText,
  House,
  Inbox,
  LogOut,
  MoreHorizontal,
  Plus,
  Search,
  Settings,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { unreadCountAction } from "@/app/actions/notifications";
import { listFavoritesAction } from "@/app/actions/page-menu";
import { archivePageAction, createPageAction, getTreeAction, movePageAction } from "@/app/actions/pages";
import type { FavoritePage } from "@/server/page-meta";
import { useChannel } from "@/components/collab/use-channel";
import { ViewIcon } from "@/components/database/property-icons";
import { cn, IconButton, MenuItem, MenuSeparator, PageIcon, pageLabel, Popover } from "@/components/ui";
import type { PageKind } from "@/db/schema/app";
import { authClient } from "@/lib/auth-client";
import { FAVORITES_EVENT } from "@/lib/favorites-event";
import type { TreeNode } from "@/server/pages";
import { InboxDialog } from "./inbox-dialog";
import { NewWorkspaceDialog } from "./new-workspace-dialog";
import { SearchDialog } from "./search-dialog";
import { SIDEBAR_WIDTH } from "@/lib/sidebar-layout";
import { SidebarPeekEdge, useSidebar } from "./sidebar-context";
import { TrashDialog } from "./trash-dialog";

type Workspace = { id: string; name: string; icon: string | null; role: string };

const EXPANDED_KEY = "esionage:expanded";

const canEdit = (node: TreeNode) => node.level === "edit" || node.level === "full";

function loadExpanded(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(EXPANDED_KEY) ?? "[]"));
  } catch {
    return new Set();
  }
}

export function Sidebar({
  workspaceId,
  workspaces,
  initialTree,
  initialFavorites,
  topLevel,
  user,
}: {
  workspaceId: string;
  workspaces: Workspace[];
  initialTree: TreeNode[];
  initialFavorites: FavoritePage[];
  /** Whether they may add top-level pages; a guest's are private to them. */
  topLevel: "shared" | "private" | null;
  user: { id: string; name: string; email: string };
}) {
  const router = useRouter();
  const t = useTranslations("sidebar");
  const tc = useTranslations("common");
  const pathname = usePathname();
  const activeId = /\/p\/([\w-]+)/.exec(pathname)?.[1] ?? null;
  const activeViewId = useSearchParams().get("view");
  const sidebar = useSidebar();
  const [tree, setTree] = useState(initialTree);
  const [favorites, setFavorites] = useState(initialFavorites);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [searchOpen, setSearchOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  // Bumped on every inbox signal so an open inbox reloads.
  const [inboxVersion, setInboxVersion] = useState(0);
  const [newWorkspaceOpen, setNewWorkspaceOpen] = useState(false);
  const [, startTransition] = useTransition();
  const [moveError, setMoveError] = useState(false);
  // Creating or trashing a page failed (e.g. access changed meanwhile).
  const [actionError, setActionError] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const workspace = workspaces.find((w) => w.id === workspaceId);
  // Guests only see pages shared with them (and their own private pages) and can't move pages to the top.
  const guest = workspace?.role === "guest";

  useEffect(() => setExpanded(loadExpanded()), []);
  useEffect(() => setTree(initialTree), [initialTree]);
  useEffect(() => setFavorites(initialFavorites), [initialFavorites]);

  const refreshFavorites = useCallback(() => {
    listFavoritesAction(workspaceId).then(setFavorites).catch(() => {});
  }, [workspaceId]);
  const refresh = useCallback(() => {
    getTreeAction(workspaceId).then(setTree).catch(() => {});
    // Renames, trash and sharing changes show up in Favorites too.
    refreshFavorites();
  }, [workspaceId, refreshFavorites]);
  const refreshInbox = useCallback(() => {
    unreadCountAction(workspaceId).then(setUnread).catch(() => {});
  }, [workspaceId]);
  useChannel(`ws:${workspaceId}`, (event) => {
    if (event === "inbox") {
      refreshInbox();
      setInboxVersion((v) => v + 1);
    } else refresh();
  });
  // Also on focus: a signal sent while the connection was down would otherwise be missed.
  useEffect(() => {
    refreshInbox();
    window.addEventListener("focus", refreshInbox);
    return () => window.removeEventListener("focus", refreshInbox);
  }, [refreshInbox]);
  useEffect(() => {
    window.addEventListener(FAVORITES_EVENT, refreshFavorites);
    return () => window.removeEventListener(FAVORITES_EVENT, refreshFavorites);
  }, [refreshFavorites]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const children = useMemo(() => {
    const map = new Map<string | null, TreeNode[]>();
    const ids = new Set(tree.map((n) => n.id));
    for (const node of tree) {
      // Children of hidden parents (e.g. rows) never reach the tree; orphans go to the root.
      const key = node.parentId && ids.has(node.parentId) ? node.parentId : null;
      map.set(key, [...(map.get(key) ?? []), node]);
    }
    for (const list of map.values()) list.sort((a, b) => a.position - b.position);
    return map;
  }, [tree]);
  const byId = useMemo(() => new Map(tree.map((n) => [n.id, n])), [tree]);

  /** Whether a dragged page may go under `parentId` (null: the top level), mirroring movePage's checks. */
  function canDrop(draggedId: string, parentId: string | null) {
    const dragged = byId.get(draggedId);
    if (!dragged || !canEdit(dragged)) return false;
    // Not into itself or one of its subpages: that would cut the branch off the tree.
    for (let id = parentId; id; id = byId.get(id)?.parentId ?? null) if (id === draggedId) return false;
    if (parentId === dragged.parentId) return true;
    // Another parent changes who inherits access to the page: that takes full access.
    if (dragged.level !== "full") return false;
    if (!parentId) return !guest;
    const parent = byId.get(parentId);
    return !!parent && canEdit(parent) && !(parent.kind === "database" && dragged.kind === "database");
  }

  function toggle(id: string, open?: boolean) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (open ?? !next.has(id)) next.add(id);
      else next.delete(id);
      try {
        localStorage.setItem(EXPANDED_KEY, JSON.stringify([...next]));
      } catch {}
      return next;
    });
  }

  function create(parentId: string | null, kind: PageKind = "page") {
    setActionError(false);
    startTransition(async () => {
      try {
        const { id } = await createPageAction({ workspaceId, parentId, kind });
        if (parentId) toggle(parentId, true);
        router.push(`/w/${workspaceId}/p/${id}`);
      } catch {
        setActionError(true);
      } finally {
        refresh();
      }
    });
  }

  function archive(id: string) {
    setActionError(false);
    startTransition(async () => {
      try {
        await archivePageAction(id);
        if (activeId === id) router.refresh();
      } catch {
        setActionError(true);
      } finally {
        refresh();
      }
    });
  }

  function move(id: string, parentId: string | null, position: number) {
    setTree((t) => t.map((n) => (n.id === id ? { ...n, parentId, position } : n)));
    if (parentId) toggle(parentId, true);
    setMoveError(false);
    startTransition(async () => {
      try {
        await movePageAction(id, parentId, position);
      } catch {
        // Usually access: a new parent needs full access on the page. The refresh puts it back.
        setMoveError(true);
      } finally {
        refresh();
      }
    });
  }
  useEffect(() => {
    if (!moveError) return;
    const timer = setTimeout(() => setMoveError(false), 5000);
    return () => clearTimeout(timer);
  }, [moveError]);
  useEffect(() => {
    if (!actionError) return;
    const timer = setTimeout(() => setActionError(false), 5000);
    return () => clearTimeout(timer);
  }, [actionError]);

  async function signOut() {
    await authClient.signOut();
    router.push("/sign-in");
    router.refresh();
  }

  const roots = children.get(null) ?? [];
  return (
    <>
      {sidebar?.drawerOpen && (
        <div aria-hidden className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={sidebar.close} />
      )}
      <SidebarPeekEdge />
      <aside
        // Desktop: an in-flow column the user can resize, or — when hidden — a panel that slides out
        // over the page while hovered. Phones: a drawer over the page.
        style={{ "--sidebar-w": `${sidebar?.width ?? 256}px` } as React.CSSProperties}
        onMouseEnter={sidebar?.collapsed ? sidebar.showPeek : undefined}
        onMouseLeave={sidebar?.collapsed ? sidebar.hidePeek : undefined}
        className={cn(
          "relative flex shrink-0 flex-col border-r border-border bg-bg-subtle text-sm",
          "max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-50 max-md:w-[min(18rem,85vw)] max-md:shadow-xl md:w-[var(--sidebar-w)]",
          sidebar?.collapsed &&
            "md:fixed md:top-12 md:bottom-3 md:left-0 md:z-50 md:rounded-r-xl md:border md:border-l-0 md:shadow-2xl md:transition-[translate,visibility] md:duration-200 md:ease-out",
          sidebar?.collapsed && (sidebar.peek ? "md:translate-x-0" : "md:invisible md:-translate-x-[calc(100%+1rem)]"),
          !sidebar?.drawerOpen && "max-md:hidden",
        )}
      >
        {sidebar && !sidebar.collapsed && <ResizeHandle />}
        <div className="p-2">
          <div className="group/head flex items-center gap-1">
            <Popover
              trigger={({ toggle }) => (
                <button
                  type="button"
                  onClick={toggle}
                  className="flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left hover:bg-bg-hover"
                >
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-fg text-[11px] font-semibold text-bg">
                    {workspace?.icon ?? workspace?.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="flex-1 truncate font-medium">{workspace?.name}</span>
                  <ChevronDown className="h-3.5 w-3.5 text-fg-muted" />
                </button>
              )}
              className="w-64"
              wrapperClassName="flex min-w-0 flex-1"
            >
              {(close) => (
                <>
                  <div className="px-2 py-1.5 text-xs text-fg-muted">{user.email}</div>
                  {workspaces.map((w) => (
                    <MenuItem
                      key={w.id}
                      active={w.id === workspaceId}
                      onClick={() => {
                        close();
                        router.push(`/w/${w.id}`);
                      }}
                    >
                      {w.name}
                    </MenuItem>
                  ))}
                  <MenuItem
                    icon={<Plus className="h-4 w-4" />}
                    onClick={() => {
                      close();
                      setNewWorkspaceOpen(true);
                    }}
                  >
                    {t("workspaceMenu.newWorkspace")}
                  </MenuItem>
                  <MenuSeparator />
                  <MenuItem
                    icon={<Settings className="h-4 w-4" />}
                    onClick={() => {
                      close();
                      router.push(`/w/${workspaceId}/settings`);
                    }}
                  >
                    {t("workspaceMenu.settingsAndMembers")}
                  </MenuItem>
                  <MenuItem icon={<LogOut className="h-4 w-4" />} onClick={signOut}>
                    {t("workspaceMenu.signOut")}
                  </MenuItem>
                </>
              )}
            </Popover>
            {sidebar &&
              (sidebar.collapsed ? (
                // Floating over the page: offer to pin it back (desktop only; phones use the drawer).
                <IconButton
                  label={t("toggle.pin")}
                  title={`${t("toggle.pin")} (⌘\\)`}
                  onClick={sidebar.toggle}
                  className="hidden h-7 w-7 md:inline-flex"
                >
                  <ChevronsRight className="h-4 w-4" />
                </IconButton>
              ) : null)}
            {sidebar && (
              <IconButton
                label={t("toggle.close")}
                title={`${t("toggle.close")} (⌘\\)`}
                onClick={sidebar.toggle}
                className={cn(
                  "h-7 w-7 md:opacity-0 md:group-hover/head:opacity-100 md:focus-visible:opacity-100",
                  sidebar.collapsed && "md:hidden",
                )}
              >
                <ChevronsLeft className="h-4 w-4" />
              </IconButton>
            )}
          </div>

          <div className="mt-1 space-y-px">
            <SidebarButton icon={<Search className="h-4 w-4" />} onClick={() => setSearchOpen(true)} hint="⌘K">
              {t("nav.search")}
            </SidebarButton>
            <SidebarButton icon={<House className="h-4 w-4" />} href={`/w/${workspaceId}`} active={pathname === `/w/${workspaceId}`}>
              {t("nav.home")}
            </SidebarButton>
            <SidebarButton
              icon={<Inbox className="h-4 w-4" />}
              onClick={() => setInboxOpen(true)}
              badge={unread > 0 ? { count: unread, label: t("inbox.unreadCount", { count: unread }) } : undefined}
            >
              {t("nav.inbox")}
            </SidebarButton>
            <SidebarButton
              icon={<Settings className="h-4 w-4" />}
              href={`/w/${workspaceId}/settings`}
              active={pathname.startsWith(`/w/${workspaceId}/settings`)}
            >
              {t("nav.settings")}
            </SidebarButton>
          </div>
        </div>

        {favorites.length > 0 && (
          <div className="shrink-0 px-2 pt-2">
            <div className="px-2 pb-1 text-xs font-medium text-fg-muted">{t("pages.favorites")}</div>
            <ul className="max-h-48 space-y-px overflow-y-auto" aria-label={t("pages.favorites")}>
              {favorites.map((f) => (
                <li key={f.id}>
                  <Link
                    href={`/w/${workspaceId}/p/${f.id}`}
                    className={cn(
                      "flex h-7 items-center gap-2 rounded-md px-2 text-sm hover:bg-bg-hover",
                      activeId === f.id ? "bg-bg-active font-medium text-fg" : "text-fg-muted",
                    )}
                  >
                    <PageIcon icon={f.icon} kind={f.kind} className="text-sm" />
                    <span className="truncate">{pageLabel(f.title, tc("untitled"))}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex items-center justify-between px-4 pb-1 pt-2">
          <span className="text-xs font-medium text-fg-muted">{t("pages.heading")}</span>
          {topLevel && (
            <Popover
              align="end"
              trigger={({ toggle }) => (
                <IconButton label={t("pages.new")} onClick={toggle}>
                  <Plus className="h-4 w-4" />
                </IconButton>
              )}
            >
              {(close) => (
                <>
                  <MenuItem
                    icon={<FileText className="h-4 w-4" />}
                    onClick={() => {
                      close();
                      create(null, "page");
                    }}
                  >
                    {t("pages.newPage")}
                  </MenuItem>
                  <MenuItem
                    icon={<Database className="h-4 w-4" />}
                    onClick={() => {
                      close();
                      create(null, "database");
                    }}
                  >
                    {t("pages.newDatabase")}
                  </MenuItem>
                </>
              )}
            </Popover>
          )}
        </div>

        {moveError && (
          <p role="alert" className="mx-4 mb-1 text-xs text-danger">
            {t("pages.moveFailed")}
          </p>
        )}
        {actionError && (
          <p role="alert" className="mx-4 mb-1 text-xs text-danger">
            {tc("genericError")}
          </p>
        )}
        <nav className="flex-1 overflow-y-auto px-2 pb-4" aria-label={t("pages.heading")}>
          {roots.length === 0 && !topLevel && <p className="px-2 py-1.5 text-fg-muted">{t("pages.nothingShared")}</p>}
          {roots.length === 0 && topLevel && (
            <button
              type="button"
              onClick={() => create(null)}
              className="w-full rounded-md px-2 py-1.5 text-left text-fg-muted hover:bg-bg-hover"
            >
              {t("pages.createFirst")}
            </button>
          )}
          <TreeLevel
            nodes={roots}
            depth={0}
            childrenOf={children}
            expanded={expanded}
            activeId={activeId}
            activeViewId={activeViewId}
            workspaceId={workspaceId}
            onToggle={toggle}
            onCreate={create}
            onArchive={archive}
            onMove={move}
            dragging={dragging}
            onDragging={setDragging}
            canDrop={canDrop}
          />
        </nav>

        <div className="border-t border-border p-2">
          <SidebarButton icon={<Trash2 className="h-4 w-4" />} onClick={() => setTrashOpen(true)}>
            {t("nav.trash")}
          </SidebarButton>
        </div>

      </aside>
      {/* Outside the aside: its slide transform would otherwise anchor these fixed dialogs. */}
      <SearchDialog workspaceId={workspaceId} open={searchOpen} onClose={() => setSearchOpen(false)} />
      <InboxDialog
        workspaceId={workspaceId}
        open={inboxOpen}
        onClose={() => setInboxOpen(false)}
        version={inboxVersion}
        onRead={refreshInbox}
      />
      <NewWorkspaceDialog open={newWorkspaceOpen} onClose={() => setNewWorkspaceOpen(false)} />
      <TrashDialog
        workspaceId={workspaceId}
        open={trashOpen}
        onClose={() => setTrashOpen(false)}
        onChange={() => {
          refresh();
          router.refresh();
        }}
      />
    </>
  );
}

/** Drag the sidebar's right edge to resize it; double-click restores the default width. */
function ResizeHandle() {
  const t = useTranslations("sidebar.toggle");
  const sidebar = useSidebar();
  const start = useRef<{ x: number; width: number } | null>(null);
  if (!sidebar) return null;
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t("resize")}
      title={t("resize")}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { x: e.clientX, width: sidebar.width };
      }}
      onPointerMove={(e) => {
        if (start.current) sidebar.setWidth(start.current.width + e.clientX - start.current.x);
      }}
      onPointerUp={(e) => {
        if (!start.current) return;
        sidebar.setWidth(start.current.width + e.clientX - start.current.x, true);
        start.current = null;
      }}
      onDoubleClick={() => sidebar.setWidth(SIDEBAR_WIDTH.default, true)}
      className="absolute inset-y-0 -right-1 z-10 hidden w-2 cursor-col-resize after:absolute after:inset-y-0 after:left-[3px] after:w-0.5 after:transition-colors hover:after:bg-accent/60 md:block"
    />
  );
}

function SidebarButton({
  icon,
  children,
  onClick,
  href,
  hint,
  active,
  badge,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  onClick?: () => void;
  href?: string;
  hint?: string;
  active?: boolean;
  /** A count shown at the end (e.g. unread notifications), with its spoken label. */
  badge?: { count: number; label: string };
}) {
  const className = cn(
    "flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-fg-muted hover:bg-bg-hover hover:text-fg",
    active && "bg-bg-active font-medium text-fg hover:bg-bg-active",
  );
  const content = (
    <>
      {icon}
      <span className="flex-1">{children}</span>
      {hint && <span className="text-xs text-fg-faint">{hint}</span>}
      {badge && (
        <span
          aria-label={badge.label}
          title={badge.label}
          className="min-w-5 rounded bg-accent px-1 text-center text-[11px] leading-[18px] font-medium text-white tabular-nums"
        >
          {badge.count > 99 ? "99+" : badge.count}
        </span>
      )}
    </>
  );
  return href ? (
    <Link href={href} className={className}>
      {content}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={className}>
      {content}
    </button>
  );
}

type DropTarget = { id: string; zone: "before" | "inside" | "after" } | null;

type TreeProps = {
  depth: number;
  childrenOf: Map<string | null, TreeNode[]>;
  expanded: Set<string>;
  activeId: string | null;
  activeViewId: string | null;
  workspaceId: string;
  onToggle: (id: string, open?: boolean) => void;
  onCreate: (parentId: string | null, kind?: PageKind) => void;
  onArchive: (id: string) => void;
  onMove: (id: string, parentId: string | null, position: number) => void;
  /** The page being dragged in this tree, if any. */
  dragging: string | null;
  onDragging: (id: string | null) => void;
  canDrop: (draggedId: string, parentId: string | null) => boolean;
};

function TreeLevel({ nodes, ...props }: TreeProps & { nodes: TreeNode[] }) {
  return (
    <ul>
      {nodes.map((node, i) => (
        <TreeItem key={node.id} node={node} prev={nodes[i - 1]} next={nodes[i + 1]} {...props} />
      ))}
    </ul>
  );
}

const DRAG_TYPE = "application/x-esionage-page";

function TreeItem({
  node,
  prev,
  next,
  ...props
}: TreeProps & { node: TreeNode; prev?: TreeNode; next?: TreeNode }) {
  const { depth, childrenOf, expanded, activeId, activeViewId, workspaceId, onToggle, onCreate, onArchive, onMove } = props;
  const { dragging, onDragging, canDrop } = props;
  const t = useTranslations("sidebar");
  const tc = useTranslations("common");
  const kids = childrenOf.get(node.id) ?? [];
  const isOpen = expanded.has(node.id);
  const [drop, setDrop] = useState<DropTarget>(null);
  // Database rows are not shown in the tree; dropping into a database would turn a page into a row.
  const canNest = node.kind === "page";
  // Trashing, adding subpages and moving all need edit access on the server.
  const editable = canEdit(node);
  // Databases expand to their views instead of child pages.
  const views = node.kind === "database" ? (node.views ?? []) : [];
  const expandable = canNest || views.length > 0;
  const active = activeId === node.id;
  const currentViewId = active ? (activeViewId && views.some((v) => v.id === activeViewId) ? activeViewId : views[0]?.id) : null;

  function zoneFor(e: React.DragEvent<HTMLDivElement>): "before" | "inside" | "after" {
    const rect = e.currentTarget.getBoundingClientRect();
    const y = (e.clientY - rect.top) / rect.height;
    if (y < 0.28) return "before";
    if (y > 0.72) return "after";
    return canNest ? "inside" : y < 0.5 ? "before" : "after";
  }

  const parentFor = (zone: "before" | "inside" | "after") => (zone === "inside" ? node.id : node.parentId);

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const draggedId = e.dataTransfer.getData(DRAG_TYPE);
    const zone = zoneFor(e);
    setDrop(null);
    onDragging(null);
    if (!draggedId || draggedId === node.id || !canDrop(draggedId, parentFor(zone))) return;
    if (zone === "inside") {
      const last = kids[kids.length - 1];
      onMove(draggedId, node.id, (last?.position ?? 0) + 1);
    } else if (zone === "before") {
      onMove(draggedId, node.parentId, prev ? (prev.position + node.position) / 2 : node.position - 1);
    } else {
      onMove(draggedId, node.parentId, next ? (node.position + next.position) / 2 : node.position + 1);
    }
  }

  return (
    <li>
      <div
        draggable={editable}
        onDragStart={(e) => {
          e.dataTransfer.setData(DRAG_TYPE, node.id);
          e.dataTransfer.effectAllowed = "move";
          onDragging(node.id);
        }}
        onDragEnd={() => onDragging(null)}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
          const zone = zoneFor(e);
          // Not accepting the drop shows the "not allowed" cursor.
          if (!dragging || !canDrop(dragging, parentFor(zone))) return setDrop(null);
          e.preventDefault();
          setDrop({ id: node.id, zone });
        }}
        onDragLeave={() => setDrop(null)}
        onDrop={onDrop}
        className={cn(
          "group relative flex h-7 items-center gap-0.5 rounded-md pr-1 hover:bg-bg-hover",
          // An open database highlights its current view row instead.
          active && !(isOpen && currentViewId) && "bg-bg-active font-medium hover:bg-bg-active",
          drop?.zone === "inside" && "bg-accent/15",
        )}
        style={{ paddingLeft: 4 + depth * 14 }}
      >
        {drop && drop.zone !== "inside" && (
          <span
            className={cn("pointer-events-none absolute left-1 right-1 h-0.5 rounded bg-accent", drop.zone === "before" ? "top-0" : "bottom-0")}
          />
        )}
        {/* The icon doubles as the expand toggle: it turns into a chevron on hover (always on touch). */}
        <button
          type="button"
          aria-label={isOpen ? t("pages.collapse") : t("pages.expand")}
          aria-expanded={expandable ? isOpen : undefined}
          disabled={!expandable}
          onClick={() => onToggle(node.id)}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-fg-faint hover:bg-bg-active hover:text-fg disabled:hover:bg-transparent"
        >
          <span className={cn("flex", expandable && "group-hover:hidden pointer-coarse:hidden")}>
            <PageIcon icon={node.icon} kind={node.kind} className="text-sm" />
          </span>
          {expandable &&
            (isOpen ? (
              <ChevronDown className="hidden h-3.5 w-3.5 group-hover:block pointer-coarse:block" />
            ) : (
              <ChevronRight className="hidden h-3.5 w-3.5 group-hover:block pointer-coarse:block" />
            ))}
        </button>
        <Link href={`/w/${workspaceId}/p/${node.id}`} className="flex min-w-0 flex-1 items-center gap-1.5 py-1 pl-0.5">
          {expandable && (
            <PageIcon icon={node.icon} kind={node.kind} className="hidden text-sm pointer-coarse:inline" />
          )}
          <span className="truncate">{pageLabel(node.title, tc("untitled"))}</span>
        </Link>
        {editable && (
          <div className="hidden items-center group-hover:flex pointer-coarse:flex">
            <Popover
              align="end"
              trigger={({ toggle }) => (
                <IconButton label={t("pages.actions")} onClick={toggle}>
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </IconButton>
              )}
            >
              {(close) => (
                <MenuItem
                  danger
                  icon={<Trash2 className="h-4 w-4" />}
                  onClick={() => {
                    close();
                    onArchive(node.id);
                  }}
                >
                  {t("pages.moveToTrash")}
                </MenuItem>
              )}
            </Popover>
            {canNest && (
              <IconButton label={t("pages.addInside")} onClick={() => onCreate(node.id)}>
                <Plus className="h-3.5 w-3.5" />
              </IconButton>
            )}
          </div>
        )}
      </div>
      {isOpen && views.length > 0 && (
        <ul>
          {views.map((v) => (
            <li key={v.id}>
              <Link
                href={`/w/${workspaceId}/p/${node.id}?view=${v.id}`}
                aria-current={v.id === currentViewId ? "page" : undefined}
                className={cn(
                  "flex h-7 items-center gap-1.5 rounded-md pr-2 text-fg-muted hover:bg-bg-hover hover:text-fg",
                  v.id === currentViewId && "bg-bg-active font-medium text-fg hover:bg-bg-active",
                )}
                style={{ paddingLeft: 4 + (depth + 1) * 14 }}
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center">
                  <ViewIcon type={v.type} className="h-3.5 w-3.5" />
                </span>
                <span className="truncate">{v.name}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {isOpen && canNest && (
        kids.length > 0 ? (
          <TreeLevel nodes={kids} {...props} depth={depth + 1} />
        ) : (
          <p className="py-1 text-xs text-fg-faint" style={{ paddingLeft: 28 + depth * 14 }}>
            {t("pages.noChildren")}
          </p>
        )
      )}
    </li>
  );
}

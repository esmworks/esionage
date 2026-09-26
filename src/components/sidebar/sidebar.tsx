"use client";

import {
  ChevronDown,
  ChevronRight,
  Database,
  FileText,
  LogOut,
  MoreHorizontal,
  Plus,
  Search,
  Settings,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { archivePageAction, createPageAction, getTreeAction, movePageAction } from "@/app/actions/pages";
import { useChannel } from "@/components/collab/use-channel";
import { cn, IconButton, MenuItem, MenuSeparator, PageIcon, pageLabel, Popover } from "@/components/ui";
import type { PageKind } from "@/db/schema/app";
import { authClient } from "@/lib/auth-client";
import type { TreeNode } from "@/server/pages";
import { NewWorkspaceDialog } from "./new-workspace-dialog";
import { SearchDialog } from "./search-dialog";
import { TrashDialog } from "./trash-dialog";

type Workspace = { id: string; name: string; icon: string | null; role: string };

const EXPANDED_KEY = "esionage:expanded";

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
  user,
}: {
  workspaceId: string;
  workspaces: Workspace[];
  initialTree: TreeNode[];
  user: { id: string; name: string; email: string };
}) {
  const router = useRouter();
  const t = useTranslations("sidebar");
  const pathname = usePathname();
  const activeId = /\/p\/([\w-]+)/.exec(pathname)?.[1] ?? null;
  const [tree, setTree] = useState(initialTree);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [searchOpen, setSearchOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [newWorkspaceOpen, setNewWorkspaceOpen] = useState(false);
  const [, startTransition] = useTransition();
  const workspace = workspaces.find((w) => w.id === workspaceId);

  useEffect(() => setExpanded(loadExpanded()), []);
  useEffect(() => setTree(initialTree), [initialTree]);

  const refresh = useCallback(() => {
    getTreeAction(workspaceId).then(setTree).catch(() => {});
  }, [workspaceId]);
  useChannel(`ws:${workspaceId}`, refresh);

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
    startTransition(async () => {
      const { id } = await createPageAction({ workspaceId, parentId, kind });
      if (parentId) toggle(parentId, true);
      refresh();
      router.push(`/w/${workspaceId}/p/${id}`);
    });
  }

  function archive(id: string) {
    startTransition(async () => {
      await archivePageAction(id);
      refresh();
      if (activeId === id) router.refresh();
    });
  }

  function move(id: string, parentId: string | null, position: number) {
    setTree((t) => t.map((n) => (n.id === id ? { ...n, parentId, position } : n)));
    if (parentId) toggle(parentId, true);
    startTransition(async () => {
      try {
        await movePageAction(id, parentId, position);
      } finally {
        refresh();
      }
    });
  }

  async function signOut() {
    await authClient.signOut();
    router.push("/sign-in");
    router.refresh();
  }

  const roots = children.get(null) ?? [];

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-bg-subtle text-sm">
      <div className="p-2">
        <Popover
          trigger={({ toggle }) => (
            <button
              type="button"
              onClick={toggle}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-bg-hover"
            >
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-fg text-[11px] font-semibold text-bg">
                {workspace?.icon ?? workspace?.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="flex-1 truncate font-medium">{workspace?.name}</span>
              <ChevronDown className="h-3.5 w-3.5 text-fg-muted" />
            </button>
          )}
          className="w-64"
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

        <div className="mt-1 space-y-px">
          <SidebarButton icon={<Search className="h-4 w-4" />} onClick={() => setSearchOpen(true)} hint="⌘K">
            {t("nav.search")}
          </SidebarButton>
          <SidebarButton icon={<Settings className="h-4 w-4" />} href={`/w/${workspaceId}/settings`}>
            {t("nav.settings")}
          </SidebarButton>
        </div>
      </div>

      <div className="flex items-center justify-between px-4 pb-1 pt-2">
        <span className="text-xs font-medium text-fg-muted">{t("pages.heading")}</span>
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
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-4" aria-label={t("pages.heading")}>
        {roots.length === 0 && (
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
          workspaceId={workspaceId}
          onToggle={toggle}
          onCreate={create}
          onArchive={archive}
          onMove={move}
        />
      </nav>

      <div className="border-t border-border p-2">
        <SidebarButton icon={<Trash2 className="h-4 w-4" />} onClick={() => setTrashOpen(true)}>
          {t("nav.trash")}
        </SidebarButton>
      </div>

      <SearchDialog workspaceId={workspaceId} open={searchOpen} onClose={() => setSearchOpen(false)} />
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
    </aside>
  );
}

function SidebarButton({
  icon,
  children,
  onClick,
  href,
  hint,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  onClick?: () => void;
  href?: string;
  hint?: string;
}) {
  const className = "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-fg-muted hover:bg-bg-hover hover:text-fg";
  const content = (
    <>
      {icon}
      <span className="flex-1">{children}</span>
      {hint && <span className="text-xs text-fg-faint">{hint}</span>}
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
  workspaceId: string;
  onToggle: (id: string, open?: boolean) => void;
  onCreate: (parentId: string | null, kind?: PageKind) => void;
  onArchive: (id: string) => void;
  onMove: (id: string, parentId: string | null, position: number) => void;
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
  const { depth, childrenOf, expanded, activeId, workspaceId, onToggle, onCreate, onArchive, onMove } = props;
  const t = useTranslations("sidebar");
  const tc = useTranslations("common");
  const kids = childrenOf.get(node.id) ?? [];
  const isOpen = expanded.has(node.id);
  const [drop, setDrop] = useState<DropTarget>(null);
  // Database rows are not shown in the tree; dropping into a database would turn a page into a row.
  const canNest = node.kind === "page";

  function zoneFor(e: React.DragEvent<HTMLDivElement>): "before" | "inside" | "after" {
    const rect = e.currentTarget.getBoundingClientRect();
    const y = (e.clientY - rect.top) / rect.height;
    if (y < 0.28) return "before";
    if (y > 0.72) return "after";
    return canNest ? "inside" : y < 0.5 ? "before" : "after";
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const draggedId = e.dataTransfer.getData(DRAG_TYPE);
    const zone = zoneFor(e);
    setDrop(null);
    if (!draggedId || draggedId === node.id) return;
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
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(DRAG_TYPE, node.id);
          e.dataTransfer.effectAllowed = "move";
        }}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
          e.preventDefault();
          setDrop({ id: node.id, zone: zoneFor(e) });
        }}
        onDragLeave={() => setDrop(null)}
        onDrop={onDrop}
        className={cn(
          "group relative flex h-7 items-center gap-0.5 rounded-md pr-1 hover:bg-bg-hover",
          activeId === node.id && "bg-bg-active font-medium hover:bg-bg-active",
          drop?.zone === "inside" && "bg-accent/15",
        )}
        style={{ paddingLeft: 4 + depth * 14 }}
      >
        {drop && drop.zone !== "inside" && (
          <span
            className={cn("pointer-events-none absolute left-1 right-1 h-0.5 rounded bg-accent", drop.zone === "before" ? "top-0" : "bottom-0")}
          />
        )}
        <button
          type="button"
          aria-label={isOpen ? t("pages.collapse") : t("pages.expand")}
          // Databases list their rows on the database page, not in the tree.
          disabled={!canNest}
          onClick={() => onToggle(node.id)}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-fg-faint hover:bg-bg-active hover:text-fg disabled:hover:bg-transparent"
        >
          {!canNest || (kids.length === 0 && !isOpen) ? (
            <PageIcon icon={node.icon} kind={node.kind} className="text-sm" />
          ) : isOpen ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </button>
        <Link href={`/w/${workspaceId}/p/${node.id}`} className="flex min-w-0 flex-1 items-center gap-1.5 py-1">
          {canNest && (kids.length > 0 || isOpen) && (
            <PageIcon icon={node.icon} kind={node.kind} className="text-sm" />
          )}
          <span className="truncate">{pageLabel(node.title, tc("untitled"))}</span>
        </Link>
        <div className="hidden items-center group-hover:flex">
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
      </div>
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

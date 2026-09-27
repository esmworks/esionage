"use client";

import { PanelLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { cn, IconButton } from "@/components/ui";
import { clampSidebarWidth, formatSidebarCookie, SIDEBAR_COOKIE, type SidebarLayout } from "@/lib/sidebar-layout";

function saveLayout(layout: SidebarLayout) {
  document.cookie = `${SIDEBAR_COOKIE}=${formatSidebarCookie(layout)}; path=/; max-age=31536000; samesite=lax`;
}

/**
 * Phone-sized screens (below `md`) show the sidebar as a drawer over the page; wider screens show it
 * as a column the user can collapse. Visibility is decided by CSS breakpoints, so the server render
 * is right on both before any script runs.
 */
type SidebarContextValue = {
  /** Desktop: hidden until reopened. */
  collapsed: boolean;
  /** Phones: the drawer is showing. */
  drawerOpen: boolean;
  width: number;
  toggle: () => void;
  close: () => void;
  /** Live width while dragging; `save` persists it. */
  setWidth: (width: number, save?: boolean) => void;
};

const SidebarContext = createContext<SidebarContextValue | null>(null);

const MOBILE_QUERY = "(max-width: 767px)";

export function SidebarProvider({ initial, children }: { initial: SidebarLayout; children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(initial.collapsed);
  const [width, setWidthState] = useState(initial.width);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const pathname = usePathname();

  // The drawer covers the page, so following a link closes it.
  useEffect(() => setDrawerOpen(false), [pathname]);

  const toggle = useCallback(() => {
    if (window.matchMedia(MOBILE_QUERY).matches) {
      setDrawerOpen((o) => !o);
      return;
    }
    setCollapsed((c) => {
      saveLayout({ collapsed: !c, width });
      return !c;
    });
  }, [width]);

  const setWidth = useCallback(
    (next: number, save?: boolean) => {
      const w = clampSidebarWidth(next);
      setWidthState(w);
      if (save) saveLayout({ collapsed, width: w });
    },
    [collapsed],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "\\") {
        e.preventDefault();
        toggle();
      } else if (e.key === "Escape") {
        setDrawerOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  const value = useMemo<SidebarContextValue>(
    () => ({
      collapsed,
      drawerOpen,
      width,
      toggle,
      close: () => setDrawerOpen(false),
      setWidth,
    }),
    [drawerOpen, collapsed, width, toggle, setWidth],
  );

  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>;
}

export function useSidebar() {
  return useContext(SidebarContext);
}

/** Opens the sidebar when it is hidden; renders nothing while it is showing. */
export function SidebarOpenButton({ className }: { className?: string }) {
  const t = useTranslations("sidebar.toggle");
  const sidebar = useSidebar();
  if (!sidebar) return null;
  return (
    <IconButton
      label={t("open")}
      title={`${t("open")} (⌘\\)`}
      className={cn("h-7 w-7", !sidebar.collapsed && "md:hidden", sidebar.drawerOpen && "max-md:hidden", className)}
      onClick={sidebar.toggle}
    >
      <PanelLeft className="h-4 w-4" />
    </IconButton>
  );
}

/** For pages without a header of their own (home, settings): a floating open button. */
export function FloatingSidebarButton() {
  const pathname = usePathname();
  // Pages render the button in their own sticky header.
  if (/\/p\/[\w-]+/.test(pathname)) return null;
  return (
    <div className="sticky top-0 z-20 h-0">
      <SidebarOpenButton className="m-2" />
    </div>
  );
}

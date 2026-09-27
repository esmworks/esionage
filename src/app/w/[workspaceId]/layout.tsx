import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { Sidebar } from "@/components/sidebar/sidebar";
import { FloatingSidebarButton, SidebarProvider } from "@/components/sidebar/sidebar-context";
import { parseSidebarCookie, SIDEBAR_COOKIE } from "@/lib/sidebar-layout";
import { getMembership } from "@/server/access";
import { listFavorites } from "@/server/page-meta";
import { getTree, listWorkspaces } from "@/server/pages";
import { requireSession, requireWorkspaceSession } from "@/server/session";
import { topLevelAccess } from "@/server/workspaces";

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspaceId: string }>;
}) {
  const { user } = await requireSession();
  const { workspaceId } = await params;
  // Before anything that reads the workspace (those throw for a held-back session). It only
  // redirects members, so outsiders don't learn the workspace exists.
  await requireWorkspaceSession(workspaceId);
  if (!(await getMembership(user.id, workspaceId))) notFound();
  const [workspaces, tree, favorites, topLevel, cookieStore] = await Promise.all([
    listWorkspaces(user.id),
    getTree(user.id, workspaceId),
    listFavorites(user.id, workspaceId),
    topLevelAccess(user.id, workspaceId),
    cookies(),
  ]);

  return (
    <SidebarProvider initial={parseSidebarCookie(cookieStore.get(SIDEBAR_COOKIE)?.value)}>
      <div className="flex h-full">
        <Sidebar
          workspaceId={workspaceId}
          workspaces={workspaces}
          initialTree={tree}
          initialFavorites={favorites}
          topLevel={topLevel}
          user={{ id: user.id, name: user.name, email: user.email }}
        />
        <main className="min-w-0 flex-1 overflow-y-auto">
          <FloatingSidebarButton />
          {children}
        </main>
      </div>
    </SidebarProvider>
  );
}

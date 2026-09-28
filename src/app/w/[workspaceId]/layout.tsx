import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { AiChatProvider } from "@/components/ai-chat/chat-panel";
import { OfflineProvider } from "@/components/offline/offline-context";
import { Sidebar } from "@/components/sidebar/sidebar";
import { FloatingSidebarButton, SidebarProvider } from "@/components/sidebar/sidebar-context";
import { canCreateWorkspace, isInstanceAdmin } from "@/lib/instance-admin";
import { USER_MARKER } from "@/lib/offline";
import { parseSidebarCookie, SIDEBAR_COOKIE } from "@/lib/sidebar-layout";
import { getMembership } from "@/server/access";
import { isEnabled as aiConfigured } from "@/server/ai";
import { aiAvailable } from "@/server/ai-writing";
import { listFavorites } from "@/server/page-meta";
import { getSidebar, listWorkspaces } from "@/server/pages";
import { requireSession, requireWorkspaceSession } from "@/server/session";
import { canCreateTeamspace } from "@/server/teamspaces";
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
  const [workspaces, sidebar, favorites, topLevel, canCreate, cookieStore, ai] = await Promise.all([
    listWorkspaces(user.id),
    getSidebar(user.id, workspaceId),
    listFavorites(user.id, workspaceId),
    topLevelAccess(user.id, workspaceId),
    canCreateTeamspace(user.id, workspaceId),
    cookies(),
    aiAvailable(workspaceId),
  ]);

  const body = (
    <div className="flex h-full">
      <Sidebar
        workspaceId={workspaceId}
        workspaces={workspaces}
        initialTree={sidebar.tree}
        initialTeamspaces={sidebar.teamspaces}
        canCreateTeamspace={canCreate}
        canCreateWorkspace={canCreateWorkspace(user)}
        isInstanceAdmin={isInstanceAdmin(user)}
        initialFavorites={favorites}
        topLevel={topLevel}
        user={{ id: user.id, name: user.name, email: user.email, image: user.image ?? null }}
      />
      <main className="min-w-0 flex-1 overflow-y-auto">
        <FloatingSidebarButton />
        {children}
      </main>
    </div>
  );

  return (
    <OfflineProvider userId={user.id}>
      {/* The service worker files this page's HTML under this user for offline use (public/sw.js). */}
      <meta name={USER_MARKER} content={user.id} />
      <SidebarProvider initial={parseSidebarCookie(cookieStore.get(SIDEBAR_COOKIE)?.value)}>
        {/* The AI chat panel (#41), when the server has an AI provider. */}
        {aiConfigured() ? (
          <AiChatProvider workspaceId={workspaceId} available={ai}>
            {body}
          </AiChatProvider>
        ) : (
          body
        )}
      </SidebarProvider>
    </OfflineProvider>
  );
}

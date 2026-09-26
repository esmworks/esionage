import { notFound } from "next/navigation";
import { ConnectedApps } from "@/components/settings/connected-apps";
import { McpInstructions } from "@/components/settings/mcp-instructions";
import { MembersSection, WorkspaceNameForm } from "@/components/settings/workspace-settings";
import { AccessError } from "@/server/access";
import { requireUser } from "@/server/session";
import { getWorkspace, listMembers } from "@/server/workspaces";

export const metadata = { title: "Settings" };

export default async function SettingsPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const user = await requireUser();
  const { workspaceId } = await params;
  const loaded = await Promise.all([getWorkspace(user.id, workspaceId), listMembers(user.id, workspaceId)]).catch(
    (error) => {
      if (error instanceof AccessError) return null;
      throw error;
    },
  );
  if (!loaded) notFound();
  const [workspace, members] = loaded;
  const isOwner = workspace.role === "owner";

  return (
    <div className="mx-auto max-w-2xl space-y-10 px-6 py-12">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Workspace</h2>
        <WorkspaceNameForm workspaceId={workspaceId} name={workspace.name} canEdit={isOwner} />
      </section>

      <MembersSection
        workspaceId={workspaceId}
        currentUserId={user.id}
        isOwner={isOwner}
        members={members.map((m) => ({ userId: m.userId, name: m.name, email: m.email, role: m.role }))}
      />

      <ConnectedApps />
      <McpInstructions />
    </div>
  );
}

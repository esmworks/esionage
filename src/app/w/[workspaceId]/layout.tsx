import { notFound } from "next/navigation";
import { Sidebar } from "@/components/sidebar/sidebar";
import { getMembership } from "@/server/access";
import { getTree, listWorkspaces } from "@/server/pages";
import { requireUser } from "@/server/session";

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspaceId: string }>;
}) {
  const user = await requireUser();
  const { workspaceId } = await params;
  if (!(await getMembership(user.id, workspaceId))) notFound();
  const [workspaces, tree] = await Promise.all([listWorkspaces(user.id), getTree(user.id, workspaceId)]);

  return (
    <div className="flex h-full">
      <Sidebar
        workspaceId={workspaceId}
        workspaces={workspaces}
        initialTree={tree}
        user={{ id: user.id, name: user.name, email: user.email }}
      />
      <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}

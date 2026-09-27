import { redirect } from "next/navigation";
import { listWorkspaces } from "@/server/pages";
import { requireUser } from "@/server/session";
import { createPersonalWorkspace } from "@/server/workspaces";

export default async function Home() {
  const user = await requireUser();
  let [first] = await listWorkspaces(user.id);
  if (!first) {
    // Left or removed from every workspace: give them a new personal one, as on sign-up, rather
    // than sending them to sign-in (which would send them straight back here).
    await createPersonalWorkspace(user.id, user.name);
    [first] = await listWorkspaces(user.id);
  }
  redirect(`/w/${first.id}`);
}

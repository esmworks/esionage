import { redirect } from "next/navigation";
import { listWorkspaces } from "@/server/pages";
import { requireUser } from "@/server/session";

export default async function Home() {
  const user = await requireUser();
  const [first] = await listWorkspaces(user.id);
  if (!first) redirect("/sign-in");
  redirect(`/w/${first.id}`);
}

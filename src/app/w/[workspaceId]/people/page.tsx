import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PeopleDirectory } from "@/components/people/people-directory";
import { AccessError } from "@/server/access";
import { peopleDirectory } from "@/server/people";
import { requireWorkspaceSession } from "@/server/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("people");
  return { title: t("metaTitle") };
}

/** The workspace's people directory. Guests (and outsiders) get a 404, as for the members list. */
export default async function PeoplePage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const { user } = await requireWorkspaceSession(workspaceId);
  const now = new Date();
  const people = await peopleDirectory(user.id, workspaceId, now).catch((error) => {
    if (error instanceof AccessError) return null;
    throw error;
  });
  if (!people) notFound();
  return <PeopleDirectory workspaceId={workspaceId} currentUserId={user.id} people={people} now={now} />;
}

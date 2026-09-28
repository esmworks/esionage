import type { WorkspaceRole } from "@/db/schema/app";
import { searchFold } from "@/lib/search-fold";

/** A page on a people directory card (see server/people.ts): one the viewer can open. */
export type DirectoryPage = { id: string; title: string; icon: string | null; kind: string; editedAt: Date };

/** One card of the people directory. Only what the viewer may see of the person is on it. */
export type DirectoryPerson = {
  userId: string;
  name: string;
  email: string;
  image: string | null;
  role: WorkspaceRole;
  teamspaces: { id: string; name: string; icon: string | null }[];
  groups: { id: string; name: string }[];
  recentPages: DirectoryPage[];
};

/**
 * Whether a card matches the directory's search: every word of the query is in the person's name,
 * email, or the name of one of their teamspaces or groups, so "design ayşe" finds Ayşe in Design.
 * Folded with searchFold, so the Turkish dotted and dotless i match either way.
 */
export function matchesPerson(person: DirectoryPerson, query: string): boolean {
  const words = searchFold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const haystack = [person.name, person.email, ...person.teamspaces.map((t) => t.name), ...person.groups.map((g) => g.name)].map(
    searchFold,
  );
  return words.every((word) => haystack.some((text) => text.includes(word)));
}

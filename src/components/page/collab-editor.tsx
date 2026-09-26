"use client";

import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import { withCollaboration } from "@blocknote/core/yjs";
import { BlockNoteView } from "@blocknote/mantine";
import { useCreateBlockNote } from "@blocknote/react";
import { useLocale } from "next-intl";
import { useEffect } from "react";
import { useEditorDictionary } from "@/i18n/blocknote";
import { COLLAB_FRAGMENT } from "@/lib/collab-constants";
import { userColor, type PageDoc } from "./use-page-doc";

export default function CollabEditor({
  pageDoc,
  user,
  editable,
}: {
  pageDoc: PageDoc;
  user: { id: string; name: string };
  editable: boolean;
}) {
  const locale = useLocale();
  const dictionary = useEditorDictionary();
  // withCollaboration spreads the remaining options into the editor options, so `dictionary`
  // reaches BlockNote as-is. A language change re-creates the editor against the same Y.Doc;
  // the provider is owned by usePageDoc and is not touched.
  const editor = useCreateBlockNote(
    withCollaboration({
      dictionary,
      collaboration: {
        fragment: pageDoc.doc.getXmlFragment(COLLAB_FRAGMENT),
        provider: { awareness: pageDoc.provider.awareness ?? undefined },
        user: { name: user.name, color: userColor(user.id) },
        showCursorLabels: "activity",
      },
    }),
    [pageDoc, dictionary],
  );

  useEffect(() => {
    editor.isEditable = editable;
  }, [editor, editable]);

  // Keyed by language so the new editor mounts into a fresh element.
  return <BlockNoteView key={locale} editor={editor} editable={editable} className="esionage-editor" />;
}

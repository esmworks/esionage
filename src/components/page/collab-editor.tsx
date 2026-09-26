"use client";

import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import { withCollaboration } from "@blocknote/core/yjs";
import { BlockNoteView } from "@blocknote/mantine";
import { useCreateBlockNote } from "@blocknote/react";
import { useEffect } from "react";
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
  const editor = useCreateBlockNote(
    withCollaboration({
      collaboration: {
        fragment: pageDoc.doc.getXmlFragment(COLLAB_FRAGMENT),
        provider: { awareness: pageDoc.provider.awareness ?? undefined },
        user: { name: user.name, color: userColor(user.id) },
        showCursorLabels: "activity",
      },
    }),
    [pageDoc],
  );

  useEffect(() => {
    editor.isEditable = editable;
  }, [editor, editable]);

  return <BlockNoteView editor={editor} editable={editable} className="esionage-editor" />;
}

"use client";

import { createFileBlockConfig, fileParse } from "@blocknote/core";
import { createReactBlockSpec, FileBlockWrapper } from "@blocknote/react";
import { pdfFileId } from "@/lib/files";
import { PdfViewer } from "./pdf-viewer";

/**
 * BlockNote's file block with one addition: an uploaded PDF shows in place (see PdfViewer). The
 * config is BlockNote's own, so documents, the server schema (which keeps the default block) and
 * the Markdown export (a link) are unchanged; any other file still shows its name.
 */
export const FileBlock = createReactBlockSpec(createFileBlockConfig, {
  meta: { fileBlockAccept: ["*/*"] },
  parse: fileParse(),
  render: function FileBlockView(props) {
    const pdf = pdfFileId(props.block.props.url, props.block.props.name);
    return (
      <FileBlockWrapper {...props}>{pdf ? <PdfViewer fileId={pdf} name={props.block.props.name} /> : undefined}</FileBlockWrapper>
    );
  },
  // As BlockNote's: a link to the file, with its caption.
  toExternalHTML: ({ block }) => {
    if (!block.props.url) return <p>{block.props.name}</p>;
    const link = <a href={block.props.url}>{block.props.name || block.props.url}</a>;
    return block.props.caption ? (
      <div>
        {link}
        <p>{block.props.caption}</p>
      </div>
    ) : (
      link
    );
  },
});

import { createBlockSpec } from "@blocknote/core";
import { bookmarkBlockConfig, parseWebUrl, webEmbedBlockConfig } from "@/lib/web-blocks";

/**
 * The server schema's side of the web blocks (configs shared with the editor in lib/web-blocks).
 * The server never shows them as cards or iframes: published pages draw them themselves (see
 * published-body.ts), and elsewhere their HTML is a plain link to the page.
 */

function linkParagraph(url: string, text: string) {
  const dom = document.createElement("p");
  const href = parseWebUrl(url)?.href;
  if (!href) return { dom };
  const link = document.createElement("a");
  link.href = href;
  link.textContent = text || href;
  dom.appendChild(link);
  return { dom };
}

function marker(type: string) {
  const dom = document.createElement("div");
  dom.setAttribute("data-esionage-web", type);
  return { dom };
}

export const webBlockServerSpecs = {
  bookmark: createBlockSpec(bookmarkBlockConfig, {
    render: () => marker("bookmark"),
    toExternalHTML: (block) => linkParagraph(block.props.url, block.props.title),
  })(),
  webEmbed: createBlockSpec(webEmbedBlockConfig, {
    render: () => marker("webEmbed"),
    toExternalHTML: (block) => linkParagraph(block.props.url, ""),
  })(),
};

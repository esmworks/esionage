import { describe, expect, it } from "vitest";
import { notionMarkdown } from "@/lib/import/notion";
import { markdownToBlocks } from "../blocknote";

/**
 * A page body as Notion's Markdown export writes it, through the same conversion the import uses
 * (notionMarkdown, then the editor's Markdown reader). Written from Notion's documented export
 * format: no real export was at hand.
 */
const NOTION_PAGE = `Intro paragraph with an inline equation $\`e^{i\\pi}+1=0\`$.

<aside>
💡 Remember to **water** the plants.

</aside>

<details>
<summary>Toggle heading text</summary>

Hidden paragraph.

- nested bullet

</details>

- [ ] Open task
- [x] Done task

| Plant | Water |
| --- | --- |
| Fern | Daily |

$$
\\int_0^1 x\\,dx
$$
`;

describe("Notion's Markdown in the editor", () => {
  it("reads callouts, toggles, to-dos, tables and equations as blocks", async () => {
    const blocks = await markdownToBlocks(notionMarkdown(NOTION_PAGE));
    expect(blocks.map((b) => b.type)).toEqual(["paragraph", "callout", "toggleListItem", "checkListItem", "checkListItem", "table", "math"]);

    const intro = blocks[0].content as { type: string; content?: unknown }[];
    expect(intro.some((n) => n.type === "inlineMath" && n.content === "e^{i\\pi}+1=0")).toBe(true);

    const callout = blocks[1] as unknown as { props: { icon: string; backgroundColor: string }; content: { text: string }[] };
    expect(callout.props.icon).toBe("💡");
    expect(callout.props.backgroundColor).toBe("gray");
    expect(callout.content.map((n) => n.text).join("")).toBe("Remember to water the plants.");

    const toggle = blocks[2];
    expect((toggle.content as { text: string }[])[0].text).toBe("Toggle heading text");
    expect(toggle.children.map((c) => c.type)).toEqual(["paragraph", "bulletListItem"]);

    expect((blocks[3].props as { checked: boolean }).checked).toBe(false);
    expect((blocks[4].props as { checked: boolean }).checked).toBe(true);
    expect((blocks[6] as unknown as { content: string }).content).toBe("\\int_0^1 x\\,dx");
  });
});

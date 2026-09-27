import { describe, expect, it } from "vitest";
import { cleanCommentBody, CommentError, commentText, MAX_COMMENT_LENGTH, safeHref, threadParticipants } from "./comments";

describe("cleanCommentBody", () => {
  it("keeps paragraphs, allowed styles and web links", () => {
    const body = cleanCommentBody([
      {
        id: "b1",
        type: "paragraph",
        props: { textColor: "red" },
        content: [
          { type: "text", text: "Hello ", styles: { bold: true, textColor: "red" } },
          { type: "link", href: "https://example.com/a", content: [{ type: "text", text: "there", styles: {} }] },
        ],
        children: [{ type: "paragraph", content: "nested" }],
      },
    ]);
    expect(body).toEqual([
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Hello ", styles: { bold: true } },
          { type: "link", href: "https://example.com/a", content: [{ type: "text", text: "there", styles: {} }] },
        ],
      },
    ]);
  });

  it("drops script links and other blocks, keeping the link's text", () => {
    const body = cleanCommentBody([
      { type: "paragraph", content: [{ type: "link", href: "javascript:alert(1)", content: "click" }] },
      { type: "image", props: { url: "https://x" } },
    ]);
    expect(body).toEqual([{ type: "paragraph", content: [{ type: "text", text: "click", styles: {} }] }]);
  });

  it("turns plain text into one paragraph per line", () => {
    expect(commentText(cleanCommentBody("one\ntwo"))).toBe("one\ntwo");
  });

  it("refuses empty and overlong comments", () => {
    expect(() => cleanCommentBody([{ type: "paragraph", content: "  " }])).toThrow(CommentError);
    expect(() => cleanCommentBody(null)).toThrow(CommentError);
    expect(() => cleanCommentBody("x".repeat(MAX_COMMENT_LENGTH + 1))).toThrow(CommentError);
  });
});

describe("safeHref", () => {
  it("allows web and email links only", () => {
    expect(safeHref("https://example.com")).toBe("https://example.com/");
    expect(safeHref("mailto:a@example.com")).toBe("mailto:a@example.com");
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("data:text/html,x")).toBeNull();
    expect(safeHref("/relative")).toBeNull();
  });
});

describe("threadParticipants", () => {
  const comment = (id: string, userId: string) => ({ id, userId, createdAt: "", updatedAt: "", deletedAt: null, body: null, reactions: [] });
  it("lists earlier commenters once, without the new comment's author", () => {
    const thread = { comments: [comment("c1", "ann"), comment("c2", "bob"), comment("c3", "ann"), comment("c4", "cem")] };
    expect(threadParticipants(thread, "cem", "c4")).toEqual(["ann", "bob"]);
    expect(threadParticipants(thread, "ann")).toEqual(["bob", "cem"]);
  });
});

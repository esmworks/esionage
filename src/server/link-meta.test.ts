import { describe, expect, it } from "vitest";
import { declaredCharset, decodeEntities, parseLinkMeta, tagAttributes } from "./link-meta";

const OPEN_GRAPH = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Fallback title</title>
  <!-- <meta property="og:title" content="Commented out"> -->
  <meta property="og:title" content="The &quot;Real&quot; Title &amp; more">
  <meta property='og:description' content='First line
    second   line'>
  <meta name="description" content="Plain description">
  <meta property="og:image" content="/images/card.png">
  <meta property="og:site_name" content="Example Site">
  <link rel="apple-touch-icon" href="/apple.png">
  <link rel="shortcut icon" href="favicon-32.png" type="image/png">
  <script>var html = '<meta property="og:image" content="https://evil.example/x.png">';</script>
</head>
<body>
  <meta property="og:description" content="In the body, ignored">
</body>
</html>`;

const TWITTER_ONLY = `<html><head>
<meta name="twitter:title" content="Tweet-sized">
<meta name="twitter:description" content="From the card">
<meta name="twitter:image" content="https://cdn.example.com/t.jpg">
</head></html>`;

const PLAIN = `<HTML><HEAD><TITLE>  Only
  a title  </TITLE><META NAME=description CONTENT=unquoted></HEAD><BODY></BODY></HTML>`;

const HOSTILE = `<html><head>
<base href="https://static.example.org/base/">
<meta property="og:title" content="${"x".repeat(1000)}">
<meta property="og:image" content="javascript:alert(1)">
<meta property="og:image:url" content="data:image/png;base64,AAAA">
<link rel="icon" href="icon.svg" type="image/svg+xml">
<link rel="icon" href="icon.png">
</head></html>`;

describe("parseLinkMeta", () => {
  it("prefers Open Graph, resolves URLs against the page and ignores comments, scripts and the body", () => {
    expect(parseLinkMeta(OPEN_GRAPH, "https://www.example.com/articles/1")).toEqual({
      title: 'The "Real" Title & more',
      description: "First line second line",
      image: "https://www.example.com/images/card.png",
      favicon: "https://www.example.com/articles/favicon-32.png",
      siteName: "Example Site",
    });
  });

  it("falls back to Twitter cards", () => {
    expect(parseLinkMeta(TWITTER_ONLY, "https://t.example/")).toEqual({
      title: "Tweet-sized",
      description: "From the card",
      image: "https://cdn.example.com/t.jpg",
      favicon: "https://t.example/favicon.ico",
      siteName: "",
    });
  });

  it("falls back to the title tag and plain meta tags, in any case", () => {
    const meta = parseLinkMeta(PLAIN, "http://old.example/page");
    expect(meta.title).toBe("Only a title");
    expect(meta.description).toBe("unquoted");
    expect(meta.favicon).toBe("http://old.example/favicon.ico");
  });

  it("drops non-http URLs, shortens long values and honors <base>", () => {
    const meta = parseLinkMeta(HOSTILE, "https://example.org/");
    expect(meta.title.length).toBeLessThanOrEqual(300);
    expect(meta.title.endsWith("…")).toBe(true);
    expect(meta.image).toBe("");
    // A PNG icon is preferred over an SVG one, and resolved against <base>.
    expect(meta.favicon).toBe("https://static.example.org/base/icon.png");
  });

  it("copes with a page cut off in the middle of its head", () => {
    const meta = parseLinkMeta('<html><head><title>Cut</title><meta property="og:description" content="unterminated', "https://a.example/");
    expect(meta.title).toBe("Cut");
    expect(meta.description).toBe("");
  });
});

describe("HTML helpers", () => {
  it("decodes named and numeric entities, leaving unknown ones", () => {
    expect(decodeEntities("a &amp; b &lt;c&gt; &#39;d&#x27; &eacute; &#0; &#xD800;")).toBe("a & b <c> 'd' &eacute; &#0; &#xD800;");
  });

  it("reads attributes quoted, unquoted and bare", () => {
    expect(tagAttributes(`<meta Property="og:title" content='It"s' data-x=1 hidden>`)).toEqual({
      property: "og:title",
      content: 'It"s',
      "data-x": "1",
      hidden: "",
    });
  });

  it("finds the declared charset", () => {
    expect(declaredCharset('<meta charset="ISO-8859-9">')).toBe("iso-8859-9");
    expect(declaredCharset('<meta http-equiv="Content-Type" content="text/html; charset=windows-1254">')).toBe("windows-1254");
    expect(declaredCharset("<title>none</title>")).toBeNull();
  });
});

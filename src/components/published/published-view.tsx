import "katex/dist/katex.min.css";
import { Copy, Menu } from "lucide-react";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import type { LoadedPage } from "@/app/s/[token]/load";
import { PropertyDisplay } from "@/components/database/property-cell";
import { PropertyTypeIcon } from "@/components/database/property-icons";
import { PublishedMermaid } from "@/components/page/mermaid-diagram";
import { PdfViewer } from "@/components/page/pdf-viewer";
import { HeadingList, Trail } from "@/components/page/page-outline";
import { BookmarkCard, EmbedFrame } from "@/components/page/web-card";
import { displayHost } from "@/lib/web-blocks";
import { PageIcon } from "@/components/ui";
import { pageLabel } from "@/lib/labels";
import { publishedHref } from "@/lib/site";
import type { PublishedBlock } from "@/server/publication";
import { PublishedDatabaseView } from "./published-database";
import { SiteNav } from "./site-nav";
import styles from "./published-body.module.css";

// `cn` from components/ui is a client export; server components join classes themselves.
const cn = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(" ");

/**
 * Read-only public view of a published page (`/s/<token>/…`), or of a page of a workspace's site
 * (`/s/<slug>/…`), which adds the site's title and navigation. Rendered on the server for visitors
 * without a session: no editor, no client data fetching.
 */
export async function PublishedView({ loaded }: { loaded: LoadedPage }) {
  const { data, site, key } = loaded;
  const [t, tc, tb, tw, format] = await Promise.all([
    getTranslations("publish"),
    getTranslations("common"),
    getTranslations("page.blocks"),
    getTranslations("page.web"),
    getFormatter(),
  ]);
  const untitled = tc("untitled");
  const titles = new Map<string, string>([...data.crumbs, ...data.children].map((p) => [p.id, p.title]));
  const href = (id: string, title?: string) => publishedHref(data.links, id, title ?? titles.get(id) ?? "");
  const wide = data.kind === "database";
  const title = pageLabel(data.title, untitled);
  const duplicateHref = data.allowDuplicate
    ? `/s/${key}/duplicate?page=${encodeURIComponent(data.id)}`
    : null;
  const current = new Set(data.crumbs.map((c) => c.id));

  const crumbs = (
    <nav aria-label={t("breadcrumbs")} className={cn("flex min-w-0 items-center gap-1 text-sm text-fg-muted", site && "max-sm:hidden")}>
      {data.crumbs.map((c, i) => {
        const last = i === data.crumbs.length - 1;
        return (
          <span key={c.id} className="flex min-w-0 items-center gap-1">
            {last ? (
              <span aria-current="page" className="flex min-w-0 items-center gap-1 px-1 text-fg">
                <PageIcon icon={c.icon} kind={c.kind} className="text-sm" />
                <span className="max-w-60 truncate">{pageLabel(c.title, untitled)}</span>
              </span>
            ) : (
              <>
                <Link href={href(c.id, c.title)} className="flex min-w-0 items-center gap-1 rounded px-1 py-0.5 hover:bg-bg-hover hover:text-fg">
                  <PageIcon icon={c.icon} kind={c.kind} className="text-sm" />
                  <span className="max-w-40 truncate">{pageLabel(c.title, untitled)}</span>
                </Link>
                <span className="text-fg-faint">/</span>
              </>
            )}
          </span>
        );
      })}
    </nav>
  );

  /**
   * A part of the body. At the top level each part has the page's side padding; inside a column
   * the columns' row has it instead.
   */
  const segment = (block: PublishedBlock, i: number, inColumn: boolean): React.ReactNode => {
    const pad = inColumn ? "" : "px-4 sm:px-[54px]";
    switch (block.kind) {
      case "html":
        return (
          <div
            key={i}
            className={cn(styles.body, pad)}
            // Serialized by BlockNote from our own document with unsafe URLs removed; see published-body.ts.
            dangerouslySetInnerHTML={{ __html: block.html }}
          />
        );
      case "columns":
        return (
          <div key={i} className={cn("my-2", pad)}>
            <div className={styles.columns}>
              {block.columns.map((column, c) => (
                <div key={c} className={styles.column} style={{ flexGrow: column.width }}>
                  {column.segments.map((inner, j) => segment(inner, j, true))}
                </div>
              ))}
            </div>
          </div>
        );
      case "toc":
        return (
          <div key={i} className={cn("my-2", pad)}>
            <HeadingList
              headings={block.headings.map((h) => ({ key: h.anchor, level: h.level, text: h.text }))}
              label={tb("toc.label")}
              empty={tb("toc.empty")}
              untitled={untitled}
              link={(anchor) => ({ href: `#${anchor}` })}
            />
          </div>
        );
      case "breadcrumb":
        return (
          <div key={i} className={cn("my-2", pad)}>
            <Trail crumbs={data.crumbs} href={(id) => href(id)} label={tb("breadcrumb.label")} untitled={untitled} />
          </div>
        );
      case "mermaid":
        return (
          <div key={i} className={cn(styles.body, "my-2", pad)}>
            <PublishedMermaid source={block.source} label={tb("mermaid.label")} />
          </div>
        );
      case "bookmark":
        return (
          <div key={i} className={cn("my-2", pad)}>
            <BookmarkCard bookmark={block.bookmark} />
          </div>
        );
      case "pdf":
        return (
          <div key={i} className={cn("my-2", pad)}>
            <PdfViewer fileId={block.fileId} name={block.name} caption={block.caption} />
          </div>
        );
      case "webEmbed":
        return (
          <div key={i} className={cn("my-2", pad)}>
            <EmbedFrame url={block.url} embed={block.embed} title={tw("embed.frameTitle", { host: displayHost(block.url) })} />
          </div>
        );
      case "embed":
        return block.database ? (
          <section key={i} className="my-4">
            <h2 className={cn("text-base font-semibold", pad)}>
              <Link href={href(block.database.id, block.database.title)} className="inline-flex items-center gap-1.5 hover:underline">
                <PageIcon icon={block.database.icon} kind="database" className="text-base" />
                {pageLabel(block.database.title, untitled)}
              </Link>
            </h2>
            <PublishedDatabaseView table={block.database.table} links={data.links} className={cn("mt-2", pad)} />
          </section>
        ) : (
          <p key={i} className={cn("my-4 rounded-md border border-border px-3 py-2 text-sm text-fg-faint", !inColumn && "mx-4 sm:mx-[54px]")}>
            {t("embedUnavailable")}
          </p>
        );
    }
  };

  return (
    <div className="flex min-h-full flex-col bg-bg text-fg">
      <header className="sticky top-0 z-20 flex h-11 items-center justify-between gap-3 border-b border-border bg-bg/90 px-3 backdrop-blur">
        <div className="flex min-w-0 items-center gap-2">
          {site && (
            <>
              <Link href={site.links.base} className="max-w-48 shrink-0 truncate text-sm font-semibold hover:underline">
                {site.title || pageLabel(site.nav[0]?.title ?? "", untitled)}
              </Link>
              {data.crumbs.length > 0 && <span className="text-fg-faint max-sm:hidden">·</span>}
            </>
          )}
          {crumbs}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {duplicateHref && (
            <Link
              href={duplicateHref}
              prefetch={false}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-bg px-2 text-xs font-medium hover:bg-bg-hover"
            >
              <Copy className="h-3.5 w-3.5" aria-hidden />
              {t("duplicate.button")}
            </Link>
          )}
          <Link href="/" className="text-sm font-semibold tracking-tight text-fg-faint hover:text-fg-muted">
            esionage
          </Link>
        </div>
      </header>

      {site && site.nav.length > 0 && (
        <details className="group border-b border-border md:hidden">
          <summary className="flex h-10 cursor-pointer list-none items-center gap-2 px-3 text-sm text-fg-muted hover:text-fg [&::-webkit-details-marker]:hidden">
            <Menu className="h-4 w-4" aria-hidden />
            {t("site.menu")}
          </summary>
          <div className="max-h-[60dvh] overflow-y-auto px-2 pb-3">
            <SiteNav nodes={site.nav} currentId={data.id} open={current} untitled={untitled} label={t("site.navigation")} />
          </div>
        </details>
      )}

      <div className="flex flex-1">
        {site && site.nav.length > 0 && (
          <aside className="sticky top-11 hidden h-[calc(100dvh-2.75rem)] w-64 shrink-0 overflow-y-auto border-r border-border bg-bg-subtle p-2 md:block">
            <SiteNav nodes={site.nav} currentId={data.id} open={current} untitled={untitled} label={t("site.navigation")} />
          </aside>
        )}

        <main className={cn("w-full min-w-0 flex-1 pb-32", wide ? "pt-10" : "mx-auto max-w-[900px] pt-12")}>
          <div className={wide ? "page-gutter" : "px-4 sm:px-[54px]"}>
            <div className={cn(wide ? "flex items-center gap-3" : "")}>
              {data.icon && <div className={cn("leading-none", wide ? "text-4xl" : "mb-3 text-5xl")}>{data.icon}</div>}
              <h1 className={cn("font-bold leading-tight break-words", wide ? "text-3xl" : "text-4xl")}>{title}</h1>
            </div>
            <p className="mt-2 text-xs text-fg-faint">
              {t("lastUpdated", { date: format.dateTime(data.updatedAt, { dateStyle: "medium", timeStyle: "short" }) })}
            </p>
          </div>

          {data.row && data.row.properties.length > 0 && (
            <dl className="mt-6 grid grid-cols-[minmax(7rem,12rem)_1fr] gap-x-4 gap-y-1 px-4 text-sm sm:px-[54px]">
              {data.row.properties.map((prop) => (
                <div key={prop.id} className="contents">
                  <dt className="flex h-8 items-center gap-1.5 text-fg-muted">
                    <PropertyTypeIcon type={prop.type} className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{prop.name}</span>
                  </dt>
                  <dd className="flex min-h-8 min-w-0 items-center py-1">
                    <PropertyDisplay prop={prop} value={data.row!.values[prop.id]} wrap />
                  </dd>
                </div>
              ))}
            </dl>
          )}

          {data.body.length > 0 && <div className="mt-6">{data.body.map((block, i) => segment(block, i, false))}</div>}

          {data.database && (
            <PublishedDatabaseView table={data.database} links={data.links} viewPath={href(data.id, data.title)} className="page-gutter mt-6" />
          )}

          {data.children.length > 0 && (
            <section className="mt-10 px-4 sm:px-[54px]">
              <h2 className="mb-2 text-sm font-medium text-fg-muted">{t("subpages")}</h2>
              <ul className="flex flex-col">
                {data.children.map((child) => (
                  <li key={child.id}>
                    <Link href={href(child.id, child.title)} className="-mx-2 flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-bg-hover">
                      <PageIcon icon={child.icon} kind={child.kind} className="text-base" />
                      <span className="truncate underline decoration-border underline-offset-4">{pageLabel(child.title, untitled)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}

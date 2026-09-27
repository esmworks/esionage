import "katex/dist/katex.min.css";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { PropertyDisplay } from "@/components/database/property-cell";
import { PropertyTypeIcon } from "@/components/database/property-icons";
import { PublishedMermaid } from "@/components/page/mermaid-diagram";
import { PdfViewer } from "@/components/page/pdf-viewer";
import { HeadingList, Trail } from "@/components/page/page-outline";
import { BookmarkCard, EmbedFrame } from "@/components/page/web-card";
import { displayHost } from "@/lib/web-blocks";
import { PageIcon } from "@/components/ui";
import { pageLabel } from "@/lib/labels";
import type { PublishedPage } from "@/server/publication";
import { PublishedDatabaseView } from "./published-database";
import styles from "./published-body.module.css";

// `cn` from components/ui is a client export; server components join classes themselves.
const cn = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(" ");

/**
 * Read-only public view of a published page (`/s/<token>/…`). Rendered on the server for visitors
 * without a session: no editor, no client data fetching.
 */
export async function PublishedView({ data }: { data: PublishedPage }) {
  const [t, tc, tb, tw, format] = await Promise.all([
    getTranslations("publish"),
    getTranslations("common"),
    getTranslations("page.blocks"),
    getTranslations("page.web"),
    getFormatter(),
  ]);
  const untitled = tc("untitled");
  const site = { base: `/s/${data.token}`, rootId: data.rootId };
  const href = (id: string) => (id === data.rootId ? site.base : `${site.base}/${id}`);
  const wide = data.kind === "database";
  const title = pageLabel(data.title, untitled);

  return (
    <div className="flex min-h-full flex-col bg-bg text-fg">
      <header className="sticky top-0 z-20 flex h-11 items-center justify-between gap-3 border-b border-border bg-bg/90 px-3 backdrop-blur">
        <nav aria-label={t("breadcrumbs")} className="flex min-w-0 items-center gap-1 text-sm text-fg-muted">
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
                    <Link
                      href={href(c.id)}
                      className="flex min-w-0 items-center gap-1 rounded px-1 py-0.5 hover:bg-bg-hover hover:text-fg"
                    >
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
        <Link href="/" className="shrink-0 text-sm font-semibold tracking-tight text-fg-faint hover:text-fg-muted">
          esionage
        </Link>
      </header>

      <main className={cn("w-full flex-1 pb-32", wide ? "pt-10" : "mx-auto max-w-[900px] pt-12")}>
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

        {data.body.length > 0 && (
          <div className="mt-6">
            {data.body.map((block, i) =>
              block.kind === "html" ? (
                <div
                  key={i}
                  className={cn(styles.body, "px-4 sm:px-[54px]")}
                  // Serialized by BlockNote from our own document with unsafe URLs removed; see published-body.ts.
                  dangerouslySetInnerHTML={{ __html: block.html }}
                />
              ) : block.kind === "toc" ? (
                <div key={i} className="my-2 px-4 sm:px-[54px]">
                  <HeadingList
                    headings={block.headings.map((h) => ({ key: h.anchor, level: h.level, text: h.text }))}
                    label={tb("toc.label")}
                    empty={tb("toc.empty")}
                    untitled={untitled}
                    link={(anchor) => ({ href: `#${anchor}` })}
                  />
                </div>
              ) : block.kind === "breadcrumb" ? (
                <div key={i} className="my-2 px-4 sm:px-[54px]">
                  <Trail crumbs={data.crumbs} href={href} label={tb("breadcrumb.label")} untitled={untitled} />
                </div>
              ) : block.kind === "mermaid" ? (
                <div key={i} className={cn(styles.body, "my-2 px-4 sm:px-[54px]")}>
                  <PublishedMermaid source={block.source} label={tb("mermaid.label")} />
                </div>
              ) : block.kind === "bookmark" ? (
                <div key={i} className="my-2 px-4 sm:px-[54px]">
                  <BookmarkCard bookmark={block.bookmark} />
                </div>
              ) : block.kind === "pdf" ? (
                <div key={i} className="my-2 px-4 sm:px-[54px]">
                  <PdfViewer fileId={block.fileId} name={block.name} caption={block.caption} />
                </div>
              ) : block.kind === "webEmbed" ? (
                <div key={i} className="my-2 px-4 sm:px-[54px]">
                  <EmbedFrame url={block.url} embed={block.embed} title={tw("embed.frameTitle", { host: displayHost(block.url) })} />
                </div>
              ) : block.database ? (
                <section key={i} className="my-4">
                  <h2 className="px-4 text-base font-semibold sm:px-[54px]">
                    <Link href={href(block.database.id)} className="inline-flex items-center gap-1.5 hover:underline">
                      <PageIcon icon={block.database.icon} kind="database" className="text-base" />
                      {pageLabel(block.database.title, untitled)}
                    </Link>
                  </h2>
                  <PublishedDatabaseView table={block.database.table} site={site} className="mt-2 px-4 sm:px-[54px]" />
                </section>
              ) : (
                <p key={i} className="mx-4 my-4 rounded-md border border-border px-3 py-2 text-sm text-fg-faint sm:mx-[54px]">
                  {t("embedUnavailable")}
                </p>
              ),
            )}
          </div>
        )}

        {data.database && (
          <PublishedDatabaseView table={data.database} site={site} viewPath={href(data.id)} className="page-gutter mt-6" />
        )}

        {data.children.length > 0 && (
          <section className="mt-10 px-4 sm:px-[54px]">
            <h2 className="mb-2 text-sm font-medium text-fg-muted">{t("subpages")}</h2>
            <ul className="flex flex-col">
              {data.children.map((child) => (
                <li key={child.id}>
                  <Link
                    href={href(child.id)}
                    className="-mx-2 flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-bg-hover"
                  >
                    <PageIcon icon={child.icon} kind={child.kind} className="text-base" />
                    <span className="truncate underline decoration-border underline-offset-4">
                      {pageLabel(child.title, untitled)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}

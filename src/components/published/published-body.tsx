import { FileText } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PropertyDisplay } from "@/components/database/property-cell";
import { PropertyTypeIcon } from "@/components/database/property-icons";
import { PublishedMermaid } from "@/components/page/mermaid-diagram";
import { HeadingList, Trail } from "@/components/page/page-outline";
import { PdfViewer } from "@/components/page/pdf-viewer";
import { BookmarkCard, EmbedFrame } from "@/components/page/web-card";
import { PageIcon } from "@/components/ui";
import { pageLabel } from "@/lib/labels";
import { displayHost } from "@/lib/web-blocks";
import type { PublishedBlock, PublishedCrumb, PublishedPage } from "@/server/publication";
import { PublishedDatabaseView } from "./published-database";
import styles from "./published-body.module.css";

// `cn` from components/ui is a client export; server components join classes themselves.
const cn = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(" ");

const GUTTER = "px-4 sm:px-[54px]";

/** A database row's properties above its body. */
export function PublishedRowProperties({ row, print = false }: { row: NonNullable<PublishedPage["row"]>; print?: boolean }) {
  return (
    <dl className={cn("mt-6 grid grid-cols-[minmax(7rem,12rem)_1fr] gap-x-4 gap-y-1 text-sm", !print && GUTTER)}>
      {row.properties.map((prop) => (
        <div key={prop.id} className="contents">
          <dt className="flex h-8 items-center gap-1.5 text-fg-muted">
            <PropertyTypeIcon type={prop.type} className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{prop.name}</span>
          </dt>
          <dd className="flex min-h-8 min-w-0 items-center py-1">
            <PropertyDisplay prop={prop} value={row.values[prop.id]} wrap />
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * A page body as published pages draw it (see server/published-body.ts), shared by the published
 * view and the print view. `site` is where a publication's pages are; without it (print) pages
 * and rows are named, not linked, and blocks that only work on screen (a PDF viewer, an embedded
 * site) print as a card naming what they hold.
 */
export async function PublishedBody({
  blocks,
  crumbs,
  site,
  unavailable,
  print = false,
}: {
  blocks: PublishedBlock[];
  crumbs: PublishedCrumb[];
  site: { base: string; rootId: string } | null;
  /** What a database block the reader can't see says. */
  unavailable: string;
  print?: boolean;
}) {
  const [tc, tb, tw, tp] = await Promise.all([
    getTranslations("common"),
    getTranslations("page.blocks"),
    getTranslations("page.web"),
    getTranslations("page.pdf"),
  ]);
  const untitled = tc("untitled");
  const href = site ? (id: string) => (id === site.rootId ? site.base : `${site.base}/${id}`) : null;
  // In print the printed page's margins are the gutter.
  const gutter = print ? "" : GUTTER;

  return (
    <div className="mt-6">
      {blocks.map((block, i) =>
        block.kind === "html" ? (
          <div
            key={i}
            className={cn(styles.body, print && styles.print, gutter)}
            // Serialized by BlockNote from our own document with unsafe URLs removed; see published-body.ts.
            dangerouslySetInnerHTML={{ __html: block.html }}
          />
        ) : block.kind === "toc" ? (
          <div key={i} className={cn("my-2", gutter)}>
            <HeadingList
              headings={block.headings.map((h) => ({ key: h.anchor, level: h.level, text: h.text }))}
              label={tb("toc.label")}
              empty={tb("toc.empty")}
              untitled={untitled}
              link={(anchor) => ({ href: `#${anchor}` })}
            />
          </div>
        ) : block.kind === "breadcrumb" ? (
          <div key={i} className={cn("my-2", gutter)}>
            <Trail crumbs={crumbs} href={href ?? undefined} label={tb("breadcrumb.label")} untitled={untitled} />
          </div>
        ) : block.kind === "mermaid" ? (
          <div key={i} className={cn(styles.body, "my-2", gutter)}>
            <PublishedMermaid source={block.source} label={tb("mermaid.label")} light={print} />
          </div>
        ) : block.kind === "bookmark" ? (
          <div key={i} className={cn("my-2", gutter, styles.keep)}>
            <BookmarkCard bookmark={block.bookmark} />
          </div>
        ) : block.kind === "pdf" ? (
          <div key={i} className={cn("my-2", gutter, styles.keep)}>
            {print ? (
              <div className="rounded-md border border-border px-3.5 py-3">
                <p className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
                  <FileText className="h-4 w-4 shrink-0 text-fg-muted" aria-hidden />
                  <span className="break-words">{block.name || tp("untitled")}</span>
                </p>
                {block.caption && <p className="pt-1.5 text-sm text-fg-muted">{block.caption}</p>}
              </div>
            ) : (
              <PdfViewer fileId={block.fileId} name={block.name} caption={block.caption} />
            )}
          </div>
        ) : block.kind === "webEmbed" ? (
          <div key={i} className={cn("my-2", gutter, styles.keep)}>
            {print ? (
              <BookmarkCard bookmark={{ url: block.url, title: "", description: "", image: "", favicon: "" }} />
            ) : (
              <EmbedFrame url={block.url} embed={block.embed} title={tw("embed.frameTitle", { host: displayHost(block.url) })} />
            )}
          </div>
        ) : block.database ? (
          <section key={i} className="my-4">
            <h2 className={cn("text-base font-semibold", gutter, styles.heading)}>
              {href ? (
                <Link href={href(block.database.id)} className="inline-flex items-center gap-1.5 hover:underline">
                  <PageIcon icon={block.database.icon} kind="database" className="text-base" />
                  {pageLabel(block.database.title, untitled)}
                </Link>
              ) : (
                <span className="inline-flex items-center gap-1.5">
                  <PageIcon icon={block.database.icon} kind="database" className="text-base" />
                  {pageLabel(block.database.title, untitled)}
                </span>
              )}
            </h2>
            <PublishedDatabaseView table={block.database.table} site={site} print={print} className={cn("mt-2", gutter)} />
          </section>
        ) : (
          <p key={i} className={cn("my-4 rounded-md border border-border px-3 py-2 text-sm text-fg-faint", !print && "mx-4 sm:mx-[54px]")}>
            {unavailable}
          </p>
        ),
      )}
    </div>
  );
}

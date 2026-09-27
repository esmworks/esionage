import { Hocuspocus, type Document, type Extension } from "@hocuspocus/server";
import { ServerBlockNoteEditor } from "@blocknote/server-util";
import { and, desc, eq, inArray } from "drizzle-orm";
import * as Y from "yjs";
import { db } from "@/db";
import { databaseProperty, page, pageSnapshot, type SnapshotReason } from "@/db/schema";
import { blocksToPlainText } from "@/lib/blocks";
import { COLLAB_FRAGMENT } from "@/lib/collab-constants";
import { migrateDocTitle, readDocTitle, writeDocTitle } from "@/lib/collab-title";
import { AccessError } from "@/server/access";
import { authorizeCollab, parseDocName as parseName } from "./authorize";
import type { Channel, CollabService, PageContent, WriteActor } from "./bridge";
import { verifyCollabToken } from "./token";

type Context = { userId?: string; userName?: string; oauthClientId?: string | null };

const AUTO_SNAPSHOT_INTERVAL_MS = 10 * 60 * 1000;
const debug = process.env.COLLAB_DEBUG ? (...args: unknown[]) => console.log("[collab]", ...args) : () => {};

const editor = ServerBlockNoteEditor.create();

const pageDocName = (pageId: string) => `page:${pageId}`;

const readTitle = readDocTitle;

async function deriveContent(doc: Y.Doc) {
  const blocks = editor.yXmlFragmentToBlocks(doc.getXmlFragment(COLLAB_FRAGMENT));
  const markdown = (await editor.blocksToMarkdownLossy(blocks)).trim();
  return { blocks, markdown, text: blocksToPlainText(blocks) };
}

async function insertSnapshot(
  pageId: string,
  doc: Y.Doc,
  reason: SnapshotReason,
  actor: { userId?: string | null; oauthClientId?: string | null },
  fallbackTitle: string,
) {
  const { markdown } = await deriveContent(doc);
  await db.insert(pageSnapshot).values({
    pageId,
    title: readTitle(doc) ?? fallbackTitle,
    ydoc: Y.encodeStateAsUpdate(doc),
    contentMarkdown: markdown,
    reason,
    createdBy: actor.userId ?? null,
    oauthClientId: actor.oauthClientId ?? null,
  });
}

async function maybeAutoSnapshot(pageId: string, doc: Y.Doc, markdown: string, title: string, userId?: string) {
  const [last] = await db
    .select({ createdAt: pageSnapshot.createdAt, contentMarkdown: pageSnapshot.contentMarkdown, title: pageSnapshot.title })
    .from(pageSnapshot)
    .where(eq(pageSnapshot.pageId, pageId))
    .orderBy(desc(pageSnapshot.createdAt))
    .limit(1);
  if (last && Date.now() - last.createdAt.getTime() < AUTO_SNAPSHOT_INTERVAL_MS) return;
  if (last && last.contentMarkdown === markdown && last.title === title) return;
  if (!last && !markdown && !title) return;
  await insertSnapshot(pageId, doc, "auto", { userId }, title);
}

/** Whether a database has a property showing when or by whom its rows were last edited. */
async function showsLastEdited(databaseId: string) {
  const [found] = await db
    .select({ id: databaseProperty.id })
    .from(databaseProperty)
    .where(
      and(
        eq(databaseProperty.databaseId, databaseId),
        inArray(databaseProperty.type, ["last_edited_time", "last_edited_by"]),
      ),
    )
    .limit(1);
  return Boolean(found);
}

export function createCollab() {
  let hocuspocus: Hocuspocus<Context>;

  const broadcast = (channel: Channel, event: string) => {
    hocuspocus.documents.get(channel)?.broadcastStateless(event);
  };

  const persistPage = async (pageId: string, doc: Document, userId?: string) => {
    const [row] = await db
      .select({ title: page.title, workspaceId: page.workspaceId, parentId: page.parentId })
      .from(page)
      .where(eq(page.id, pageId))
      .limit(1);
    if (!row) return; // deleted while open
    const { markdown, text } = await deriveContent(doc);
    const title = readTitle(doc) ?? row.title;
    await db
      .update(page)
      .set({
        ydoc: Y.encodeStateAsUpdate(doc),
        contentMarkdown: markdown,
        contentText: text,
        title,
        ...(userId ? { updatedBy: userId } : {}),
      })
      .where(eq(page.id, pageId));
    if (title !== row.title) {
      broadcast(`ws:${row.workspaceId}`, "tree");
      if (row.parentId) broadcast(`db:${row.parentId}`, "rows");
    } else if (row.parentId && (await showsLastEdited(row.parentId))) {
      // A body edit moves the row's "last edited" values, which open views of its database show.
      broadcast(`db:${row.parentId}`, "rows");
    }
    await maybeAutoSnapshot(pageId, doc, markdown, title, userId);
  };

  const extension: Extension<Context> = {
    extensionName: "esionage",

    async onAuthenticate({ token, documentName, connectionConfig }) {
      const user = verifyCollabToken(token);
      const target = parseName(documentName);
      if (!user || !target) throw new Error("unauthorized");
      try {
        // People who may only read get the live document but their edits are dropped.
        const { readOnly } = await authorizeCollab(user.userId, target);
        if (readOnly) connectionConfig.readOnly = true;
      } catch (error) {
        if (error instanceof AccessError) throw new Error("forbidden");
        throw error;
      }
      return { userId: user.userId, userName: user.userName } satisfies Context;
    },

    async onLoadDocument({ documentName, document }) {
      const target = parseName(documentName);
      if (target?.kind !== "page") return document; // ws:/db: docs are signal-only
      const [row] = await db.select({ ydoc: page.ydoc }).from(page).where(eq(page.id, target.id)).limit(1);
      if (row?.ydoc) Y.applyUpdate(document, row.ydoc);
      // Never write here (e.g. seeding meta.title): after a server restart, clients resync
      // their local state and a server-side write would race it as a concurrent CRDT edit.
      // An absent title falls back to page.title everywhere.
      return document;
    },

    async onChange({ documentName, update }) {
      debug("change", documentName, update.byteLength);
    },

    async onStoreDocument({ documentName, document, lastContext }) {
      debug("store", documentName);
      const target = parseName(documentName);
      if (target?.kind !== "page") return;
      try {
        await persistPage(target.id, document, lastContext?.userId);
      } catch (error) {
        // Hocuspocus swallows hook errors; a failed save must be visible in the logs.
        console.error(`[collab] failed to persist ${documentName}`, error);
        throw error;
      }
    },
  };

  hocuspocus = new Hocuspocus<Context>({
    name: "esionage",
    quiet: true,
    debounce: 2000,
    maxDebounce: 10000,
    extensions: [extension],
  });

  /** Runs a transaction against the page's shared doc (loading it if needed) and persists it. */
  const transactPage = async (pageId: string, actor: WriteActor, fn: (doc: Document) => void | Promise<void>) => {
    const conn = await hocuspocus.openDirectConnection(pageDocName(pageId), {
      userId: actor.userId,
      oauthClientId: actor.oauthClientId,
    });
    try {
      // Async prep (markdown parsing) happens inside fn before its synchronous transact call.
      await fn(conn.document!);
    } finally {
      await conn.disconnect();
    }
  };

  const snapshotBefore = async (pageId: string, doc: Y.Doc, reason: SnapshotReason, actor: WriteActor) => {
    const [row] = await db.select({ title: page.title }).from(page).where(eq(page.id, pageId)).limit(1);
    await insertSnapshot(pageId, doc, reason, actor, row?.title ?? "");
  };

  const writeBlocks = async (
    pageId: string,
    actor: WriteActor,
    build: (existing: Awaited<ReturnType<typeof deriveContent>>["blocks"]) => Promise<typeof existing>,
    snapshot: boolean,
  ) => {
    await transactPage(pageId, actor, async (doc) => {
      if (snapshot) await snapshotBefore(pageId, doc, "before_mcp_write", actor);
      const existing = editor.yXmlFragmentToBlocks(doc.getXmlFragment(COLLAB_FRAGMENT));
      const next = await build(existing);
      doc.transact(
        () => {
          // Diff-based: unchanged blocks keep their Yjs identity, so open editors keep cursors.
          editor.blocksToYXmlFragment(next, doc.getXmlFragment(COLLAB_FRAGMENT));
        },
        { source: "local", context: actor },
      );
    });
  };

  const service: CollabService = {
    async readPage(pageId): Promise<PageContent> {
      const live = hocuspocus.documents.get(pageDocName(pageId));
      if (live) {
        const { markdown, text } = await deriveContent(live);
        const [row] = await db.select({ title: page.title }).from(page).where(eq(page.id, pageId)).limit(1);
        return { title: readTitle(live) ?? row?.title ?? "", markdown, text };
      }
      const [row] = await db
        .select({ title: page.title, markdown: page.contentMarkdown, text: page.contentText })
        .from(page)
        .where(eq(page.id, pageId))
        .limit(1);
      return row ?? { title: "", markdown: "", text: "" };
    },

    async replaceContent(pageId, markdown, actor, snapshot = false) {
      await writeBlocks(pageId, actor, async () => editor.tryParseMarkdownToBlocks(markdown), snapshot);
    },

    async appendContent(pageId, markdown, actor, snapshot = false) {
      await writeBlocks(
        pageId,
        actor,
        async (existing) => {
          const added = await editor.tryParseMarkdownToBlocks(markdown);
          // A fresh page holds one empty paragraph; drop it instead of leaving a gap.
          const trimmed = existing.filter(
            (b, i) => !(i === existing.length - 1 && b.type === "paragraph" && !blocksToPlainText([b]) && !b.children.length),
          );
          return [...trimmed, ...added];
        },
        snapshot,
      );
    },

    async setTitle(pageId, title, actor) {
      await transactPage(pageId, actor, (doc) => {
        writeDocTitle(doc, title, { source: "local", context: actor });
      });
    },

    async restoreSnapshot(snapshotId, actor) {
      const [snap] = await db.select().from(pageSnapshot).where(eq(pageSnapshot.id, snapshotId)).limit(1);
      if (!snap) throw new AccessError();
      const old = new Y.Doc();
      Y.applyUpdate(old, snap.ydoc);
      const blocks = editor.yXmlFragmentToBlocks(old.getXmlFragment(COLLAB_FRAGMENT));
      await transactPage(snap.pageId, actor, async (doc) => {
        await snapshotBefore(snap.pageId, doc, "before_restore", actor);
        migrateDocTitle(doc, { source: "local", context: actor });
        doc.transact(
          () => {
            editor.blocksToYXmlFragment(blocks, doc.getXmlFragment(COLLAB_FRAGMENT));
            writeDocTitle(doc, snap.title, { source: "local", context: actor });
          },
          { source: "local", context: actor },
        );
      });
      old.destroy();
    },

    broadcast,

    async disconnectUser(userId, workspaceId) {
      const open = [...hocuspocus.documents.values()].filter((doc) =>
        doc.getConnections().some((c) => (c.context as Context).userId === userId),
      );
      const pageIds = open.flatMap((doc) => {
        const target = parseName(doc.name);
        return target && target.kind !== "ws" ? [target.id] : [];
      });
      const inWorkspace = new Set(
        pageIds.length
          ? (
              await db
                .select({ id: page.id })
                .from(page)
                .where(and(eq(page.workspaceId, workspaceId), inArray(page.id, pageIds)))
            ).map((r) => r.id)
          : [],
      );
      for (const doc of open) {
        const target = parseName(doc.name);
        const affected = target?.kind === "ws" ? target.id === workspaceId : !!target && inWorkspace.has(target.id);
        if (!affected) continue;
        for (const connection of doc.getConnections()) {
          if ((connection.context as Context).userId === userId) connection.close({ code: 4403, reason: "Forbidden" });
        }
      }
    },
  };

  return { hocuspocus, service };
}

"use client";

/**
 * The AI chat panel (#41): questions about the workspace, answered from the pages the person can
 * open, with citations that link to them (and scroll to the passage). Opened from the sidebar's
 * "Ask AI"; it stays open while the person moves between pages. The answer streams in from
 * `/api/ai/chat` (see server/ai-chat.ts); Stop cancels it. Conversations are kept on the server for
 * this person only, listed under the clock button. Needs the server and AI on in the workspace,
 * and says so otherwise.
 */
import { CircleStop, History, Loader2, SendHorizontal, SquarePen, Trash2, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { deleteConversationAction, getConversationAction, listConversationsAction } from "@/app/actions/ai";
import { useIsOffline } from "@/components/offline/offline-context";
import { FOCUS_BLOCK_EVENT } from "@/components/page/block-focus";
import { cn, IconButton, MenuItem, MenuSeparator, PageIcon, pageLabel, Popover } from "@/components/ui";
import { isAiErrorCode } from "@/lib/ai";
import {
  MAX_CHAT_MESSAGE,
  sourceHref,
  splitCitations,
  type ChatEvent,
  type ChatMessageView,
  type ChatSourceView,
  type ConversationSummary,
} from "@/lib/ai-chat";

type ChatContext = { available: boolean; open: boolean; setOpen: (open: boolean) => void };
const Context = createContext<ChatContext | null>(null);

/** The chat's open state for the sidebar's button; null when the server has no AI provider. */
export function useAiChat() {
  return useContext(Context);
}

/**
 * Holds the panel for a workspace's pages. `available`: AI is on in the workspace (the panel
 * explains when it isn't). Only rendered when the server has an AI provider.
 */
export function AiChatProvider({ workspaceId, available, children }: { workspaceId: string; available: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const value = useMemo(() => ({ available, open, setOpen }), [available, open]);
  return (
    <Context.Provider value={value}>
      {children}
      {open && <ChatPanel workspaceId={workspaceId} available={available} onClose={() => setOpen(false)} />}
    </Context.Provider>
  );
}

type Status = { kind: "thinking" } | { kind: "search_pages" | "read_page"; detail: string };

type Message = ChatMessageView & { key: string };

let keys = 0;
const nextKey = () => `m${++keys}`;

function ChatPanel({ workspaceId, available, onClose }: { workspaceId: string; available: boolean; onClose: () => void }) {
  const t = useTranslations("ai.chat");
  const ta = useTranslations("ai");
  const router = useRouter();
  const pathname = usePathname();
  const currentPageId = /\/p\/([\w-]+)/.exec(pathname)?.[1] ?? null;
  const offline = useIsOffline();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [scope, setScope] = useState<"workspace" | "page">("workspace");
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<ConversationSummary[] | null>(null);
  const abort = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const running = status !== null;
  const blocked = offline ? t("offline") : !available ? t("disabled") : null;
  const pageScope = scope === "page" && currentPageId ? currentPageId : null;

  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !running) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, running]);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  // Follow the answer as it streams, unless the person scrolled up to read.
  useEffect(() => {
    const el = listRef.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 120) el.scrollTop = el.scrollHeight;
  }, [messages, status]);

  const errorText = useCallback(
    (code: unknown) => {
      const c = isAiErrorCode(code) ? code : "provider";
      // The chat says some things its own way; the rest as the other AI features do.
      if (c === "noAccess" || c === "tooLarge" || c === "disabled" || c === "invalid") return t(`errors.${c}`);
      return ta(`errors.${c}`);
    },
    [t, ta],
  );

  const updateLast = (fn: (m: Message) => Message) =>
    setMessages((list) => (list.length && list[list.length - 1].role === "assistant" ? [...list.slice(0, -1), fn(list[list.length - 1])] : list));

  async function send() {
    const question = input.trim();
    if (!question || running || blocked) return;
    setError(null);
    setInput("");
    const controller = new AbortController();
    abort.current = controller;
    setMessages((list) => [...list, { key: nextKey(), role: "user", content: question }, { key: nextKey(), role: "assistant", content: "" }]);
    setStatus({ kind: "thinking" });
    let failed: string | null = null;
    let finished = false;
    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, conversationId, message: question, scope: pageScope ? { pageId: pageScope } : null }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const body = (await response.json().catch(() => null)) as { error?: { code?: string } } | null;
        failed = errorText(body?.error?.code);
        return;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffered = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffered += decoder.decode(value, { stream: true });
        const lines = buffered.split("\n");
        buffered = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as ChatEvent;
          if (event.type === "conversation") setConversationId(event.id);
          else if (event.type === "tool") setStatus({ kind: event.name, detail: event.detail });
          else if (event.type === "text") {
            setStatus((s) => (s?.kind === "thinking" ? s : { kind: "thinking" }));
            updateLast((m) => ({ ...m, content: m.content + event.text }));
          } else if (event.type === "reset") updateLast((m) => ({ ...m, content: "" }));
          else if (event.type === "sources") updateLast((m) => ({ ...m, sources: event.sources }));
          else if (event.type === "done") {
            finished = true;
            if (event.stopReason === "length") updateLast((m) => ({ ...m, note: "cutOff" }));
          } else if (event.type === "error") {
            if (event.code === "aborted") updateLast((m) => ({ ...m, note: "stopped" }));
            else failed = errorText(event.code);
          }
        }
      }
      if (!finished && !failed && !controller.signal.aborted) failed = errorText("provider");
    } catch {
      if (controller.signal.aborted) updateLast((m) => ({ ...m, note: "stopped" }));
      else failed = errorText("provider");
    } finally {
      if (abort.current === controller) abort.current = null;
      setStatus(null);
      if (failed) {
        setError(failed);
        // Nothing was answered: the question goes back into the box.
        setMessages((list) => {
          const last = list[list.length - 1];
          return last?.role === "assistant" && !last.content.trim() ? list.slice(0, -2) : list;
        });
        setInput((current) => current || question);
      }
    }
  }

  function stop() {
    abort.current?.abort();
  }

  function newChat() {
    stop();
    setConversationId(null);
    setMessages([]);
    setError(null);
    inputRef.current?.focus();
  }

  async function loadHistory() {
    const result = await listConversationsAction(workspaceId);
    setHistory(result.ok ? result.data : []);
  }

  async function openConversation(id: string) {
    stop();
    const result = await getConversationAction(workspaceId, id);
    if (!result.ok) {
      setError(t("loadFailed"));
      return;
    }
    setError(null);
    setConversationId(result.data.id);
    setMessages(result.data.messages.map((m) => ({ ...m, key: nextKey() })));
  }

  async function remove(id: string | "all") {
    if (id === "all" && !confirm(t("confirmDeleteAll"))) return;
    const result = await deleteConversationAction(workspaceId, id);
    if (!result.ok) return;
    if (id === "all" || id === conversationId) newChat();
    await loadHistory();
  }

  function openSource(source: ChatSourceView) {
    const href = sourceHref(source);
    if (!href || !source.pageId) return;
    if (source.pageId === currentPageId) {
      if (source.blockId) window.dispatchEvent(new CustomEvent(FOCUS_BLOCK_EVENT, { detail: { blockId: source.blockId } }));
      return;
    }
    router.push(href);
    // On a phone the panel covers the page.
    if (window.matchMedia("(max-width: 767px)").matches) onClose();
  }

  return (
    <aside
      aria-label={t("title")}
      className="fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l border-border bg-bg shadow-xl md:w-[400px]"
    >
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-border px-3">
        <h2 className="flex-1 truncate text-sm font-semibold">{t("title")}</h2>
        <Popover
          align="end"
          className="w-72"
          trigger={({ toggle }) => (
            <IconButton
              label={t("history")}
              className="h-7 w-7"
              onClick={() => {
                void loadHistory();
                toggle();
              }}
              disabled={offline}
            >
              <History className="h-4 w-4" />
            </IconButton>
          )}
        >
          {(close) => (
            <div className="max-h-80 overflow-y-auto">
              {history === null ? (
                <p className="px-2 py-1.5 text-sm text-fg-muted">
                  <Loader2 className="inline h-3.5 w-3.5 animate-spin" />
                </p>
              ) : history.length === 0 ? (
                <p className="px-2 py-1.5 text-sm text-fg-muted">{t("noHistory")}</p>
              ) : (
                <>
                  {history.map((c) => (
                    <div key={c.id} className={cn("group flex items-center gap-1 rounded", c.id === conversationId && "bg-bg-hover")}>
                      <button
                        type="button"
                        className="min-w-0 flex-1 truncate rounded px-2 py-1.5 text-left text-sm hover:bg-bg-hover"
                        onClick={() => {
                          close();
                          void openConversation(c.id);
                        }}
                      >
                        {c.title || t("untitled")}
                      </button>
                      <IconButton label={t("deleteConversation")} className="h-7 w-7 opacity-60 group-hover:opacity-100" onClick={() => void remove(c.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </IconButton>
                    </div>
                  ))}
                  <MenuSeparator />
                  <MenuItem
                    icon={<Trash2 className="h-4 w-4" />}
                    danger
                    onClick={() => {
                      close();
                      void remove("all");
                    }}
                  >
                    {t("deleteAll")}
                  </MenuItem>
                </>
              )}
            </div>
          )}
        </Popover>
        <IconButton label={t("newChat")} className="h-7 w-7" onClick={newChat} disabled={!messages.length && !conversationId}>
          <SquarePen className="h-4 w-4" />
        </IconButton>
        <IconButton label={t("close")} className="h-7 w-7" onClick={onClose}>
          <X className="h-4 w-4" />
        </IconButton>
      </div>

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-3" aria-live="polite">
        {messages.length === 0 ? (
          <p className="py-6 text-sm text-fg-muted">{t("intro")}</p>
        ) : (
          <ol className="space-y-4">
            {messages.map((m, i) => (
              <li key={m.key}>
                {m.role === "user" ? (
                  <div className="ml-8 rounded-lg bg-bg-subtle px-3 py-2 text-sm whitespace-pre-wrap break-words">{m.content}</div>
                ) : (
                  <Answer
                    message={m}
                    status={i === messages.length - 1 ? status : null}
                    onSource={openSource}
                    labels={{
                      sources: t("sources"),
                      gone: t("sourceGone"),
                      stopped: t("stopped"),
                      cutOff: t("cutOff"),
                      status: (s) =>
                        s.kind === "thinking"
                          ? t("thinking")
                          : s.kind === "search_pages"
                            ? t("searching", { query: s.detail })
                            : t("reading", { title: s.detail }),
                    }}
                  />
                )}
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="shrink-0 border-t border-border p-3">
        {blocked && (
          <p role="status" className="mb-2 text-sm text-fg-muted">
            {blocked}
          </p>
        )}
        {error && (
          <p role="alert" className="mb-2 text-sm text-danger">
            {error}
          </p>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
          className="flex items-end gap-2 rounded-lg border border-border bg-bg px-2 py-1.5 focus-within:border-accent"
        >
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send();
              }
            }}
            rows={Math.min(6, Math.max(1, input.split("\n").length))}
            maxLength={MAX_CHAT_MESSAGE}
            disabled={Boolean(blocked)}
            placeholder={t("placeholder")}
            aria-label={t("placeholder")}
            className="max-h-40 min-h-7 flex-1 resize-none bg-transparent py-1 text-sm outline-none placeholder:text-fg-faint disabled:opacity-60"
          />
          {running ? (
            <IconButton label={t("stop")} className="h-7 w-7" onClick={stop}>
              <CircleStop className="h-4 w-4" />
            </IconButton>
          ) : (
            <IconButton label={t("send")} type="submit" className="h-7 w-7" disabled={Boolean(blocked) || !input.trim()}>
              <SendHorizontal className="h-4 w-4" />
            </IconButton>
          )}
        </form>
        <div className="mt-2 flex items-center gap-2 text-xs text-fg-muted">
          <label htmlFor="ai-chat-scope">{t("scope")}</label>
          <select
            id="ai-chat-scope"
            value={pageScope ? "page" : "workspace"}
            onChange={(e) => setScope(e.target.value === "page" ? "page" : "workspace")}
            disabled={running}
            className="h-6 min-w-0 flex-1 rounded border border-border bg-bg px-1 text-xs text-fg"
          >
            <option value="workspace">{t("scopeWorkspace")}</option>
            <option value="page" disabled={!currentPageId}>
              {t("scopePage")}
            </option>
          </select>
        </div>
        <p className="mt-1.5 text-xs text-fg-faint">{t("note")}</p>
      </div>
    </aside>
  );
}

type Labels = { sources: string; gone: string; stopped: string; cutOff: string; status: (s: Status) => string };

function Answer({
  message,
  status,
  onSource,
  labels,
}: {
  message: Message;
  status: Status | null;
  onSource: (source: ChatSourceView) => void;
  labels: Labels;
}) {
  const byNumber = new Map((message.sources ?? []).map((s) => [s.n, s]));
  return (
    <div className="text-sm leading-relaxed">
      {message.content && <AnswerText text={message.content} sources={byNumber} onSource={onSource} />}
      {status && !(status.kind === "thinking" && message.content) && (
        <p className="flex items-center gap-1.5 text-fg-muted">
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
          <span className="truncate">{labels.status(status)}</span>
        </p>
      )}
      {message.note && <p className="mt-1 text-xs text-fg-muted">{message.note === "stopped" ? labels.stopped : labels.cutOff}</p>}
      {message.sources && message.sources.length > 0 && (
        <div className="mt-2">
          <p className="text-xs font-medium text-fg-muted">{labels.sources}</p>
          <ul className="mt-1 space-y-0.5">
            {message.sources.map((s) => (
              <li key={s.n} className="flex items-center gap-1.5 text-xs">
                <span className="w-5 shrink-0 text-right text-fg-faint tabular-nums">{s.n}</span>
                {s.pageId ? (
                  <button
                    type="button"
                    onClick={() => onSource(s)}
                    className="flex min-w-0 items-center gap-1 rounded px-1 py-0.5 text-left hover:bg-bg-hover"
                  >
                    <PageIcon icon={s.icon} className="text-xs" />
                    <span className="truncate">{pageLabel(s.title ?? "")}</span>
                  </button>
                ) : (
                  <span className="px-1 text-fg-faint">{labels.gone}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** A small Markdown subset: paragraphs, lists, headings as bold lines, **bold**, `code`, citations. */
function AnswerText({
  text,
  sources,
  onSource,
}: {
  text: string;
  sources: Map<number, ChatSourceView>;
  onSource: (source: ChatSourceView) => void;
}) {
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let paragraph: string[] = [];
  const flushParagraph = () => {
    if (paragraph.length) blocks.push(<p key={blocks.length} className="mb-2">{inline(paragraph.join("\n"), sources, onSource)}</p>);
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    const items = list.items.map((item, i) => <li key={i}>{inline(item, sources, onSource)}</li>);
    blocks.push(
      list.ordered ? (
        <ol key={blocks.length} className="mb-2 list-decimal space-y-0.5 pl-5">
          {items}
        </ol>
      ) : (
        <ul key={blocks.length} className="mb-2 list-disc space-y-0.5 pl-5">
          {items}
        </ul>
      ),
    );
    list = null;
  };
  for (const line of text.split("\n")) {
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const heading = /^\s*#{1,6}\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      flushParagraph();
      const ordered = Boolean(numbered);
      if (list && list.ordered !== ordered) flushList();
      list ??= { ordered, items: [] };
      list.items.push((bullet ?? numbered)![1]);
    } else if (!line.trim()) {
      flushParagraph();
      flushList();
    } else if (heading) {
      flushParagraph();
      flushList();
      blocks.push(
        <p key={blocks.length} className="mb-1 font-semibold">
          {inline(heading[1], sources, onSource)}
        </p>,
      );
    } else {
      flushList();
      paragraph.push(line);
    }
  }
  flushParagraph();
  flushList();
  return <div className="break-words [&>*:last-child]:mb-0">{blocks}</div>;
}

function inline(text: string, sources: Map<number, ChatSourceView>, onSource: (source: ChatSourceView) => void): ReactNode[] {
  const out: ReactNode[] = [];
  splitCitations(text).forEach((part, i) => {
    if (part.type === "cite") {
      const source = sources.get(part.n);
      out.push(
        source?.pageId ? (
          <button
            key={i}
            type="button"
            onClick={() => onSource(source)}
            title={pageLabel(source.title ?? "")}
            className="mx-0.5 inline-flex h-4 min-w-4 -translate-y-0.5 items-center justify-center rounded bg-bg-active px-1 align-middle text-[10px] font-medium text-fg-muted hover:bg-accent hover:text-accent-fg"
          >
            {part.n}
          </button>
        ) : (
          <span key={i} className="mx-0.5 align-middle text-[10px] text-fg-faint">
            {part.n}
          </span>
        ),
      );
      return;
    }
    // **bold** and `code`; everything else as written.
    part.text.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`)/g).forEach((piece, j) => {
      if (!piece) return;
      if (piece.startsWith("**") && piece.endsWith("**") && piece.length > 4) out.push(<strong key={`${i}-${j}`}>{piece.slice(2, -2)}</strong>);
      else if (piece.startsWith("`") && piece.endsWith("`") && piece.length > 2) {
        out.push(
          <code key={`${i}-${j}`} className="rounded bg-bg-active px-1 text-[0.9em]">
            {piece.slice(1, -1)}
          </code>,
        );
      } else out.push(<span key={`${i}-${j}`} className="whitespace-pre-wrap">{piece}</span>);
    });
  });
  return out;
}

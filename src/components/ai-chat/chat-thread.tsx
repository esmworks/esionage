"use client";

/**
 * A conversation's messages and the question box, as the panel and the full-page chat show them.
 * Answers render as markdown with their citations and sources, under the steps taken to them
 * (searches, pages read): listed as they happen, then folded into how long it took.
 */
import { BookOpen, ChevronRight, CircleStop, Lightbulb, Loader2, Search, SendHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";
import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { cn, IconButton, PageIcon, pageLabel } from "@/components/ui";
import { MAX_CHAT_MESSAGE, type ChatSourceView, type ChatStepView } from "@/lib/ai-chat";
import type { Chat, ChatMessage, ChatStatus } from "./use-chat";

export function ChatThread({
  chat,
  blocked,
  onSend,
  onSource,
  footer,
  variant,
}: {
  chat: Chat;
  /** Why questions can't be asked now (offline, AI off), shown above the box. */
  blocked: string | null;
  onSend: () => void;
  onSource: (source: ChatSourceView) => void;
  /** Under the box, before the note (the panel's scope picker). */
  footer?: ReactNode;
  variant: "panel" | "page";
}) {
  const t = useTranslations("ai.chat");
  const { messages, status, error, input, setInput, running, inputRef } = chat;
  const listRef = useRef<HTMLDivElement>(null);
  const page = variant === "page";

  useEffect(() => {
    inputRef.current?.focus();
  }, [inputRef]);
  // Follow the answer as it streams, unless the person scrolled up to read; an opened conversation
  // starts at its end.
  const shownConversation = useRef(chat.conversationId);
  useEffect(() => {
    const el = listRef.current;
    const opened = shownConversation.current !== chat.conversationId;
    shownConversation.current = chat.conversationId;
    if (el && (opened || el.scrollHeight - el.scrollTop - el.clientHeight < 120)) el.scrollTop = el.scrollHeight;
  }, [messages, status, chat.conversationId]);

  const send = () => {
    if (!blocked) onSend();
  };

  return (
    <>
      <div ref={listRef} className={cn("min-h-0 flex-1 overflow-y-auto", page ? "px-4 py-6 md:px-8" : "px-4 py-3")} aria-live="polite">
        <div className={cn(page && "mx-auto w-full max-w-3xl")}>
          {messages.length === 0 ? (
            <p className={cn("text-sm text-fg-muted", page ? "py-10 text-center" : "py-6")}>{t("intro")}</p>
          ) : (
            <ol className={cn(page ? "space-y-6" : "space-y-4")}>
              {messages.map((m, i) => (
                <li key={m.key}>
                  {m.role === "user" ? (
                    <div
                      className={cn(
                        "rounded-lg bg-bg-subtle px-3 py-2 text-sm whitespace-pre-wrap break-words",
                        page ? "ml-auto w-fit max-w-[80%]" : "ml-8",
                      )}
                    >
                      {m.content}
                    </div>
                  ) : (
                    <Answer
                      message={m}
                      status={i === messages.length - 1 ? status : null}
                      onSource={onSource}
                      labels={{ sources: t("sources"), gone: t("sourceGone"), stopped: t("stopped"), cutOff: t("cutOff"), thinking: t("thinking") }}
                    />
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>

      <div className={cn("shrink-0", page ? "px-4 pb-4 md:px-8" : "border-t border-border p-3")}>
        <div className={cn(page && "mx-auto w-full max-w-3xl")}>
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
              send();
            }}
            className={cn(
              "flex items-end gap-2 rounded-lg border border-border bg-bg px-2 py-1.5 focus-within:border-accent",
              page && "px-3 py-2 shadow-sm",
            )}
          >
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send();
                }
              }}
              rows={Math.min(6, Math.max(page ? 2 : 1, input.split("\n").length))}
              maxLength={MAX_CHAT_MESSAGE}
              disabled={Boolean(blocked)}
              placeholder={t("placeholder")}
              aria-label={t("placeholder")}
              className="max-h-40 min-h-7 flex-1 resize-none bg-transparent py-1 text-sm outline-none placeholder:text-fg-faint disabled:opacity-60"
            />
            {running ? (
              <IconButton label={t("stop")} className="h-7 w-7" onClick={chat.stop}>
                <CircleStop className="h-4 w-4" />
              </IconButton>
            ) : (
              <IconButton label={t("send")} type="submit" className="h-7 w-7" disabled={Boolean(blocked) || !input.trim()}>
                <SendHorizontal className="h-4 w-4" />
              </IconButton>
            )}
          </form>
          {footer}
          <p className={cn("mt-1.5 text-xs text-fg-faint", page && "text-center")}>{t("note")}</p>
        </div>
      </div>
    </>
  );
}

type Labels = { sources: string; gone: string; stopped: string; cutOff: string; thinking: string };

function Answer({
  message,
  status,
  onSource,
  labels,
}: {
  message: ChatMessage;
  status: ChatStatus | null;
  onSource: (source: ChatSourceView) => void;
  labels: Labels;
}) {
  const byNumber = new Map((message.sources ?? []).map((s) => [s.n, s]));
  return (
    <div className="text-sm leading-relaxed">
      {message.steps ? (
        <Steps message={message} status={status} onSource={onSource} />
      ) : (
        // Answers kept from before steps were.
        status === "thinking" &&
        !message.content && (
          <p className="flex items-center gap-1.5 text-fg-muted">
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
            <span className="truncate">{labels.thinking}</span>
          </p>
        )
      )}
      {message.content && <AnswerText text={message.content} sources={byNumber} onSource={onSource} />}
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

/**
 * The steps an answer took: open with a running clock while it's being written, then folded into
 * how long it took (the person can open it again).
 */
function Steps({ message, status, onSource }: { message: ChatMessage; status: ChatStatus | null; onSource: (source: ChatSourceView) => void }) {
  const t = useTranslations("ai.chat");
  const live = status !== null;
  const [open, setOpen] = useState<boolean | null>(null);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [live]);
  const ms = live || message.ms === undefined ? Date.now() - (message.startedAt ?? Date.now()) : message.ms;
  const seconds = Math.max(live ? 0 : 1, Math.round(ms / 1000));
  const time = seconds < 60 ? t("steps.seconds", { s: seconds }) : t("steps.minutes", { m: Math.floor(seconds / 60), s: seconds % 60 });
  const expanded = open ?? live;
  const steps = message.steps ?? [];

  return (
    <div className="mb-2">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setOpen(!expanded)}
        className="-ml-1 flex items-center gap-1.5 rounded px-1 py-0.5 text-fg-muted hover:bg-bg-hover hover:text-fg"
      >
        <span className="tabular-nums">{live ? t("steps.working", { time }) : t("steps.worked", { time })}</span>
        <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-90")} />
      </button>
      {expanded && (
        <ol className="mt-1 ml-1.5 space-y-1 border-l border-border pl-3 text-fg-muted">
          {steps.map((step, i) => (
            <li key={i} className="flex min-w-0 items-start gap-1.5">
              <StepLine step={step} onSource={onSource} />
            </li>
          ))}
          {status === "thinking" && (
            <li className="flex items-center gap-1.5">
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
              <span>{t("thinking")}</span>
            </li>
          )}
        </ol>
      )}
    </div>
  );
}

function StepLine({ step, onSource }: { step: ChatStepView; onSource: (source: ChatSourceView) => void }) {
  const t = useTranslations("ai.chat");
  const icon = "mt-[3px] h-3.5 w-3.5 shrink-0";
  if (step.kind === "search") {
    return (
      <>
        <Search className={icon} />
        <span className="min-w-0 break-words">
          {step.query === null ? t("steps.question", { count: step.results }) : t("steps.searched", { query: step.query, count: step.results })}
        </span>
      </>
    );
  }
  if (step.kind === "read") {
    const read = step.page;
    return (
      <>
        <BookOpen className={icon} />
        {read ? (
          <span className="flex min-w-0 items-center gap-1">
            {t("steps.read")}
            <button
              type="button"
              onClick={() => onSource({ n: 0, pageId: read.pageId, workspaceId: read.workspaceId, title: read.title, icon: read.icon, blockId: null })}
              className="flex min-w-0 items-center gap-1 rounded px-0.5 text-fg underline decoration-border underline-offset-2 hover:bg-bg-hover"
            >
              <PageIcon icon={read.icon} className="text-xs" />
              <span className="truncate">{pageLabel(read.title)}</span>
            </button>
          </span>
        ) : (
          <span>{t("steps.readGone")}</span>
        )}
      </>
    );
  }
  return (
    <>
      <Lightbulb className={icon} />
      <span className="line-clamp-2 min-w-0 break-words">{step.text}</span>
    </>
  );
}

// The markdown renderer comes with the first answer, not with every page.
const AnswerMarkdown = lazy(() => import("./answer-markdown"));

function AnswerText({
  text,
  sources,
  onSource,
}: {
  text: string;
  sources: Map<number, ChatSourceView>;
  onSource: (source: ChatSourceView) => void;
}) {
  return (
    <Suspense fallback={<p className="break-words whitespace-pre-wrap">{text}</p>}>
      <AnswerMarkdown text={text} sources={sources} onSource={onSource} />
    </Suspense>
  );
}

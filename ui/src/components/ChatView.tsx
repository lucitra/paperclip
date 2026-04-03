import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@/lib/router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Agent, IssueComment } from "@paperclipai/shared";
import { heartbeatsApi, type LiveRunForIssue } from "../api/heartbeats";
import type { TranscriptEntry } from "../adapters/types";
import { queryKeys } from "../lib/queryKeys";
import { MarkdownBody } from "./MarkdownBody";
import { RunTranscriptView } from "./transcript/RunTranscriptView";
import { useLiveRunTranscripts } from "./transcript/useLiveRunTranscripts";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ArrowUp, Loader2, Square } from "lucide-react";
import { cn } from "../lib/utils";
import { timeAgo } from "../lib/timeAgo";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface CommentWithRunMeta extends IssueComment {
  runId?: string | null;
  runAgentId?: string | null;
  clientStatus?: "pending" | "queued";
  queueState?: "queued";
}

export interface ChatViewProps {
  issueId: string;
  companyId?: string | null;
  comments: CommentWithRunMeta[];
  queuedComments?: CommentWithRunMeta[];
  currentUserId?: string | null;
  agentMap?: Map<string, Agent>;
  onSend: (body: string) => Promise<void>;
  disabled?: boolean;
}

/* ------------------------------------------------------------------ */
/*  ChatBubble                                                         */
/* ------------------------------------------------------------------ */

const ChatBubble = memo(function ChatBubble({
  comment,
  isUser,
  agentMap,
}: {
  comment: CommentWithRunMeta;
  isUser: boolean;
  agentMap?: Map<string, Agent>;
}) {
  const isPending = comment.clientStatus === "pending";
  const agentName = comment.authorAgentId
    ? agentMap?.get(comment.authorAgentId)?.name ?? comment.authorAgentId.slice(0, 8)
    : null;

  return (
    <div className={cn("flex gap-2.5 max-w-[85%]", isUser ? "ml-auto flex-row-reverse" : "mr-auto")}>
      <div className="shrink-0 mt-1">
        {isUser ? (
          <Avatar size="sm">
            <AvatarFallback>You</AvatarFallback>
          </Avatar>
        ) : agentName ? (
          <Link to={`/agents/${comment.authorAgentId}`} className="block">
            <Avatar size="sm">
              <AvatarFallback>{agentName.slice(0, 2).toUpperCase()}</AvatarFallback>
            </Avatar>
          </Link>
        ) : (
          <Avatar size="sm">
            <AvatarFallback>?</AvatarFallback>
          </Avatar>
        )}
      </div>

      <div
        className={cn(
          "rounded-2xl px-3.5 py-2.5 text-sm min-w-0 break-words",
          isUser
            ? "bg-primary text-primary-foreground rounded-tr-sm"
            : "bg-accent/60 border border-border/50 rounded-tl-sm",
          isPending && "opacity-60",
        )}
      >
        {!isUser && agentName && (
          <div className="text-[11px] font-medium text-muted-foreground mb-1">{agentName}</div>
        )}
        <MarkdownBody className={cn("text-sm", isUser && "[&_*]:text-primary-foreground")}>
          {comment.body}
        </MarkdownBody>
        <div
          className={cn(
            "text-[10px] mt-1",
            isUser ? "text-primary-foreground/60" : "text-muted-foreground",
          )}
        >
          {isPending ? "Sending..." : timeAgo(comment.createdAt)}
          {comment.runId && !isUser && (
            <>
              {" · "}
              {comment.runAgentId ? (
                <Link
                  to={`/agents/${comment.runAgentId}/runs/${comment.runId}`}
                  className="hover:underline"
                >
                  run {comment.runId.slice(0, 8)}
                </Link>
              ) : (
                <span>run {comment.runId.slice(0, 8)}</span>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
});

/* ------------------------------------------------------------------ */
/*  StreamingBubble – shows live run transcript inline                  */
/* ------------------------------------------------------------------ */

function StreamingBubble({
  run,
  transcript,
  hasOutput,
  onCancel,
  agentMap,
}: {
  run: LiveRunForIssue;
  transcript: TranscriptEntry[];
  hasOutput: boolean;
  onCancel?: (runId: string) => Promise<void>;
  agentMap?: Map<string, Agent>;
}) {
  const isActive = run.status === "queued" || run.status === "running";
  const agentName = agentMap?.get(run.agentId)?.name ?? run.agentName;

  if (!isActive) return null;

  return (
    <div className="flex gap-2.5 mr-auto max-w-[85%]">
      <div className="shrink-0 mt-1">
        <Link to={`/agents/${run.agentId}`} className="block">
          <Avatar size="sm">
            <AvatarFallback>{agentName.slice(0, 2).toUpperCase()}</AvatarFallback>
          </Avatar>
        </Link>
      </div>
      <div className="rounded-2xl rounded-tl-sm bg-accent/60 border border-border/50 px-3.5 py-2.5 min-w-0 w-full">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-medium text-muted-foreground">{agentName}</span>
            <Loader2 className="h-3 w-3 animate-spin text-cyan-500" />
          </div>
          {onCancel && (
            <button
              onClick={() => onCancel(run.id)}
              className="inline-flex items-center gap-1 rounded-full border border-red-500/20 bg-red-500/[0.06] px-2 py-0.5 text-[10px] font-medium text-red-700 transition-colors hover:bg-red-500/[0.12] dark:text-red-300"
            >
              <Square className="h-2 w-2" fill="currentColor" />
              Stop
            </button>
          )}
        </div>
        <div className="max-h-[240px] overflow-y-auto">
          <RunTranscriptView
            entries={transcript}
            density="compact"
            limit={6}
            streaming
            collapseStdout
            emptyMessage={hasOutput ? "Parsing..." : "Working..."}
          />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  ChatComposer                                                       */
/* ------------------------------------------------------------------ */

function ChatComposer({
  onSend,
  disabled,
}: {
  onSend: (body: string) => Promise<void>;
  disabled?: boolean;
}) {
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(async () => {
    const trimmed = value.trim();
    if (!trimmed || sending || disabled) return;
    setSending(true);
    try {
      await onSend(trimmed);
      setValue("");
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
    } finally {
      setSending(false);
    }
  }, [value, sending, disabled, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void handleSend();
      }
    },
    [handleSend],
  );

  const handleInput = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, []);

  const canSend = value.trim().length > 0 && !sending && !disabled;

  return (
    <div className="border-t border-border bg-background px-4 py-3">
      <div className="flex items-end gap-2 rounded-xl border border-border bg-accent/30 px-3 py-2 focus-within:border-primary/40 transition-colors">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            handleInput();
          }}
          onKeyDown={handleKeyDown}
          placeholder="Message..."
          rows={1}
          disabled={disabled}
          className="flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground min-h-[24px] max-h-[160px]"
        />
        <Button
          size="icon-sm"
          disabled={!canSend}
          onClick={() => void handleSend()}
          className={cn(
            "shrink-0 rounded-lg h-7 w-7 transition-colors",
            canSend
              ? "bg-primary text-primary-foreground hover:bg-primary/90"
              : "bg-muted text-muted-foreground",
          )}
        >
          {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowUp className="h-3.5 w-3.5" />}
        </Button>
      </div>
      <p className="text-[10px] text-muted-foreground mt-1.5 text-center">
        Enter to send · Shift+Enter for new line
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  ChatView                                                           */
/* ------------------------------------------------------------------ */

function toIsoString(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.toISOString();
}

export function ChatView({
  issueId,
  companyId,
  comments,
  queuedComments = [],
  currentUserId,
  agentMap,
  onSend,
  disabled,
}: ChatViewProps) {
  const queryClient = useQueryClient();
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // Fetch live runs (same queries as LiveRunWidget)
  const { data: liveRuns } = useQuery({
    queryKey: queryKeys.issues.liveRuns(issueId),
    queryFn: () => heartbeatsApi.liveRunsForIssue(issueId),
    enabled: !!issueId,
    refetchInterval: 3000,
  });

  const { data: activeRun } = useQuery({
    queryKey: queryKeys.issues.activeRun(issueId),
    queryFn: () => heartbeatsApi.activeRunForIssue(issueId),
    enabled: !!issueId,
    refetchInterval: 3000,
  });

  const runs = useMemo(() => {
    const deduped = new Map<string, LiveRunForIssue>();
    for (const run of liveRuns ?? []) deduped.set(run.id, run);
    if (activeRun) {
      deduped.set(activeRun.id, {
        id: activeRun.id,
        status: activeRun.status,
        invocationSource: activeRun.invocationSource,
        triggerDetail: activeRun.triggerDetail,
        startedAt: toIsoString(activeRun.startedAt),
        finishedAt: toIsoString(activeRun.finishedAt),
        createdAt: toIsoString(activeRun.createdAt) ?? new Date().toISOString(),
        agentId: activeRun.agentId,
        agentName: activeRun.agentName,
        adapterType: activeRun.adapterType,
        issueId,
      });
    }
    return [...deduped.values()].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }, [activeRun, issueId, liveRuns]);

  const { transcriptByRun, hasOutputForRun } = useLiveRunTranscripts({ runs, companyId });

  const activeRuns = useMemo(
    () => runs.filter((r) => r.status === "queued" || r.status === "running"),
    [runs],
  );

  const allComments = useMemo(
    () => [...comments, ...queuedComments],
    [comments, queuedComments],
  );

  const handleCancelRun = useCallback(async (runId: string) => {
    await heartbeatsApi.cancel(runId);
    queryClient.invalidateQueries({ queryKey: queryKeys.issues.liveRuns(issueId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.issues.activeRun(issueId) });
  }, [issueId, queryClient]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [allComments.length, activeRuns.length, autoScroll, transcriptByRun]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    setAutoScroll(nearBottom);
  }, []);

  return (
    <div className="flex flex-col min-h-[400px]">
      {/* Messages area */}
      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-4 py-4 space-y-3 max-h-[600px]">
        {allComments.length === 0 && activeRuns.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <p className="text-sm">No messages yet.</p>
            <p className="text-xs mt-1">Send a message to start the conversation.</p>
          </div>
        )}

        {allComments.map((comment) => {
          const isUser = !!comment.authorUserId && comment.authorUserId === currentUserId;
          return (
            <ChatBubble
              key={comment.id}
              comment={comment}
              isUser={isUser}
              agentMap={agentMap}
            />
          );
        })}

        {activeRuns.map((run) => (
          <StreamingBubble
            key={run.id}
            run={run}
            transcript={transcriptByRun.get(run.id) ?? []}
            hasOutput={hasOutputForRun(run.id)}
            onCancel={handleCancelRun}
            agentMap={agentMap}
          />
        ))}

        <div ref={bottomRef} />
      </div>

      {/* Composer */}
      <ChatComposer onSend={onSend} disabled={disabled} />
    </div>
  );
}

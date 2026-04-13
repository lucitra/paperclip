/**
 * Git Changes Panel — right-side panel showing staged/unstaged files,
 * diffs, and commit controls for the selected workspace.
 *
 * Follows Conductor/Superset pattern: compact, workspace-aware, togglable.
 */

import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  GitBranch,
  Plus,
  Minus,
  RefreshCw,
  X,
  ChevronRight,
  FileText,
  FilePlus,
  FileX,
  FilePen,
  HelpCircle,
  ArrowLeft,
} from "lucide-react";
import { useWorkspace } from "../context/WorkspaceContext";
import { projectsApi } from "../api/projects";
import { queryKeys } from "../lib/queryKeys";
import { cn } from "../lib/utils";

// ── Status icon mapping ────────────────────────────────────────────

function statusIcon(status: string) {
  switch (status) {
    case "M": return <FilePen className="h-3.5 w-3.5 text-yellow-500" />;
    case "A": return <FilePlus className="h-3.5 w-3.5 text-green-500" />;
    case "D": return <FileX className="h-3.5 w-3.5 text-red-500" />;
    case "R": return <FileText className="h-3.5 w-3.5 text-blue-500" />;
    case "?": return <HelpCircle className="h-3.5 w-3.5 text-muted-foreground/50" />;
    default: return <FileText className="h-3.5 w-3.5 text-muted-foreground" />;
  }
}

function statusLabel(status: string) {
  switch (status) {
    case "M": return "Modified";
    case "A": return "Added";
    case "D": return "Deleted";
    case "R": return "Renamed";
    case "?": return "Untracked";
    default: return status;
  }
}

function fileName(path: string) {
  return path.split("/").pop() ?? path;
}

function dirName(path: string) {
  const parts = path.split("/");
  return parts.length > 1 ? parts.slice(0, -1).join("/") + "/" : "";
}

// ── Diff viewer ────────────────────────────────────────────────────

function DiffViewer({ diff }: { diff: string }) {
  if (!diff) {
    return <div className="px-3 py-6 text-center text-xs text-muted-foreground">No changes</div>;
  }

  const lines = diff.split("\n");
  return (
    <pre className="text-[11px] leading-[1.6] font-mono overflow-auto">
      {lines.map((line, i) => {
        let cls = "px-3 ";
        if (line.startsWith("+++") || line.startsWith("---")) {
          cls += "text-muted-foreground/60";
        } else if (line.startsWith("+")) {
          cls += "bg-green-500/10 text-green-400";
        } else if (line.startsWith("-")) {
          cls += "bg-red-500/10 text-red-400";
        } else if (line.startsWith("@@")) {
          cls += "text-blue-400/70 bg-blue-500/5";
        } else if (line.startsWith("diff ")) {
          cls += "text-muted-foreground/40 font-semibold";
        } else {
          cls += "text-foreground/70";
        }
        return <div key={i} className={cls}>{line || " "}</div>;
      })}
    </pre>
  );
}

// ── File item ──────────────────────────────────────────────────────

function GitFileItem({
  path: filePath,
  status,
  staged,
  onToggle,
  onSelect,
  selected,
}: {
  path: string;
  status: string;
  staged: boolean;
  onToggle: () => void;
  onSelect: () => void;
  selected: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 px-2 py-1 rounded-sm cursor-pointer group transition-colors",
        selected ? "bg-accent" : "hover:bg-accent/50",
      )}
      onClick={onSelect}
    >
      {statusIcon(status)}
      <div className="flex-1 min-w-0 flex items-baseline gap-1">
        <span className="text-[12px] font-medium text-foreground truncate">{fileName(filePath)}</span>
        <span className="text-[10px] text-muted-foreground/40 truncate">{dirName(filePath)}</span>
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); onToggle(); }}
        className="shrink-0 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-accent transition-opacity text-muted-foreground hover:text-foreground"
        title={staged ? "Unstage" : "Stage"}
      >
        {staged ? <Minus className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
      </button>
    </div>
  );
}

// ── Section header ─────────────────────────────────────────────────

function SectionHeader({
  label,
  count,
  expanded,
  onToggle,
  action,
}: {
  label: string;
  count: number;
  expanded: boolean;
  onToggle: () => void;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex items-center gap-1.5 px-2 py-1.5">
      <button
        onClick={onToggle}
        className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-widest text-muted-foreground/60 bg-transparent border-none cursor-pointer p-0"
      >
        <ChevronRight className={cn("h-3 w-3 transition-transform", expanded && "rotate-90")} />
        {label}
      </button>
      <span className="text-[10px] text-muted-foreground/40">{count}</span>
      {action && count > 0 && (
        <button
          onClick={action.onClick}
          className="ml-auto text-[10px] text-muted-foreground/50 hover:text-foreground bg-transparent border-none cursor-pointer p-0"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

// ── Main panel ─────────────────────────────────────────────────────

export function GitChangesPanel({ onClose }: { onClose: () => void }) {
  const { selected, branch, dirty } = useWorkspace();
  const workspaceId = selected?.workspace.id;
  const queryClient = useQueryClient();

  // State
  const [commitMessage, setCommitMessage] = useState("");
  const [stagedExpanded, setStagedExpanded] = useState(true);
  const [unstagedExpanded, setUnstagedExpanded] = useState(true);
  const [selectedFile, setSelectedFile] = useState<{ path: string; staged: boolean } | null>(null);

  // Queries
  const { data: status, isLoading, refetch } = useQuery({
    queryKey: queryKeys.git.status(workspaceId ?? ""),
    queryFn: () => projectsApi.getWorkspaceGitStatus(workspaceId!),
    enabled: !!workspaceId,
    refetchInterval: 5000,
  });

  const { data: diffData, isLoading: diffLoading } = useQuery({
    queryKey: queryKeys.git.diff(workspaceId ?? "", selectedFile?.path ?? "", selectedFile?.staged ?? false),
    queryFn: () => projectsApi.getWorkspaceGitDiff(workspaceId!, selectedFile!.path, selectedFile!.staged),
    enabled: !!workspaceId && !!selectedFile,
  });

  // Mutations
  const invalidateGit = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: queryKeys.git.status(workspaceId ?? "") });
    queryClient.invalidateQueries({ queryKey: ["workspace-git-info", workspaceId] });
  }, [queryClient, workspaceId]);

  const stageMutation = useMutation({
    mutationFn: (paths: string[]) => projectsApi.stageFiles(workspaceId!, paths),
    onSuccess: invalidateGit,
  });

  const unstageMutation = useMutation({
    mutationFn: (paths: string[]) => projectsApi.unstageFiles(workspaceId!, paths),
    onSuccess: invalidateGit,
  });

  const commitMutation = useMutation({
    mutationFn: (message: string) => projectsApi.commitChanges(workspaceId!, message),
    onSuccess: () => {
      invalidateGit();
      setCommitMessage("");
    },
  });

  const staged = status?.staged ?? [];
  const unstaged = status?.unstaged ?? [];

  if (!workspaceId) {
    return (
      <aside className="w-[360px] border-l border-border bg-background flex flex-col">
        <div className="px-3 py-2 border-b border-border flex items-center justify-between">
          <span className="text-xs font-medium">Changes</span>
          <button onClick={onClose} className="p-0.5 text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
        </div>
        <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground">
          Select a workspace
        </div>
      </aside>
    );
  }

  // Diff sub-view
  if (selectedFile) {
    return (
      <aside className="w-[360px] border-l border-border bg-background flex flex-col min-h-0">
        <div className="px-3 py-2 border-b border-border flex items-center gap-2">
          <button
            onClick={() => setSelectedFile(null)}
            className="p-0.5 text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
          </button>
          <div className="flex-1 min-w-0">
            <span className="text-xs font-medium truncate block">{fileName(selectedFile.path)}</span>
            <span className="text-[10px] text-muted-foreground/50">{selectedFile.staged ? "Staged" : "Unstaged"}</span>
          </div>
          <button onClick={onClose} className="p-0.5 text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
        </div>
        <div className="flex-1 overflow-auto min-h-0">
          {diffLoading ? (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">Loading diff...</div>
          ) : (
            <DiffViewer diff={diffData?.diff ?? ""} />
          )}
        </div>
      </aside>
    );
  }

  return (
    <aside className="w-[360px] border-l border-border bg-background flex flex-col min-h-0">
      {/* Header */}
      <div className="px-3 py-2 border-b border-border flex items-center gap-2 shrink-0">
        <GitBranch className="h-3.5 w-3.5 text-muted-foreground/50" />
        <span className="text-xs font-medium">Changes</span>
        {branch && (
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-accent/60 text-muted-foreground/70">{branch}</span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => refetch()}
            className="p-1 text-muted-foreground/50 hover:text-foreground rounded transition-colors"
            title="Refresh"
          >
            <RefreshCw className="h-3 w-3" />
          </button>
          <button onClick={onClose} className="p-1 text-muted-foreground/50 hover:text-foreground rounded"><X className="h-3 w-3" /></button>
        </div>
      </div>

      {/* Commit form */}
      <div className="px-3 py-2 border-b border-border shrink-0">
        <textarea
          value={commitMessage}
          onChange={(e) => setCommitMessage(e.target.value)}
          placeholder="Commit message..."
          className="w-full text-xs bg-transparent border border-border rounded px-2 py-1.5 resize-none focus:outline-none focus:border-foreground/30 text-foreground placeholder:text-muted-foreground/40"
          rows={2}
        />
        <button
          onClick={() => commitMutation.mutate(commitMessage)}
          disabled={!commitMessage.trim() || staged.length === 0 || commitMutation.isPending}
          className="mt-1.5 w-full text-xs font-medium py-1.5 rounded bg-foreground text-background hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed transition-opacity"
        >
          {commitMutation.isPending ? "Committing..." : `Commit${staged.length > 0 ? ` (${staged.length})` : ""}`}
        </button>
        {commitMutation.isError && (
          <div className="mt-1 text-[10px] text-red-400">{(commitMutation.error as Error)?.message ?? "Commit failed"}</div>
        )}
      </div>

      {/* File lists */}
      <div className="flex-1 overflow-auto min-h-0">
        {isLoading ? (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">Loading...</div>
        ) : staged.length === 0 && unstaged.length === 0 ? (
          <div className="px-3 py-10 text-center">
            <p className="text-xs text-muted-foreground">No changes</p>
            <p className="text-[10px] text-muted-foreground/40 mt-1">Working tree is clean</p>
          </div>
        ) : (
          <>
            {/* Staged */}
            <SectionHeader
              label="Staged"
              count={staged.length}
              expanded={stagedExpanded}
              onToggle={() => setStagedExpanded(!stagedExpanded)}
              action={{ label: "Unstage all", onClick: () => unstageMutation.mutate(staged.map((f) => f.path)) }}
            />
            {stagedExpanded && staged.map((f) => (
              <GitFileItem
                key={`s:${f.path}`}
                path={f.path}
                status={f.status}
                staged
                onToggle={() => unstageMutation.mutate([f.path])}
                onSelect={() => setSelectedFile({ path: f.path, staged: true })}
                selected={selectedFile?.path === f.path && selectedFile?.staged === true}
              />
            ))}

            {/* Unstaged */}
            <SectionHeader
              label="Unstaged"
              count={unstaged.length}
              expanded={unstagedExpanded}
              onToggle={() => setUnstagedExpanded(!unstagedExpanded)}
              action={{ label: "Stage all", onClick: () => stageMutation.mutate(unstaged.map((f) => f.path)) }}
            />
            {unstagedExpanded && unstaged.map((f) => (
              <GitFileItem
                key={`u:${f.path}`}
                path={f.path}
                status={f.status}
                staged={false}
                onToggle={() => stageMutation.mutate([f.path])}
                onSelect={() => setSelectedFile({ path: f.path, staged: false })}
                selected={selectedFile?.path === f.path && selectedFile?.staged === false}
              />
            ))}
          </>
        )}
      </div>
    </aside>
  );
}

/**
 * Scripts tab — saved shell commands scoped to a workspace.
 *
 * Run sends the command text to the workspace terminal (opens it if closed,
 * remounts the session for a fresh shell). Scripts persist in localStorage
 * under `paperclip:workspace-scripts:<workspaceId>`.
 */

import { useEffect, useMemo, useState } from "react";
import { Play, Plus, Trash2, Sparkles } from "lucide-react";
import { cn } from "../lib/utils";
import {
  loadScripts,
  saveScripts,
  newScriptId,
  STARTER_SCRIPTS,
  type WorkspaceScript,
} from "../lib/workspaceScripts";

interface ScriptsTabProps {
  workspaceId: string;
  onRun: (command: string) => void;
}

export function ScriptsTab({ workspaceId, onRun }: ScriptsTabProps) {
  const [scripts, setScripts] = useState<WorkspaceScript[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftCommand, setDraftCommand] = useState("");

  useEffect(() => {
    setScripts(loadScripts(workspaceId));
    setLoaded(true);
    setAddOpen(false);
    setDraftName("");
    setDraftCommand("");
  }, [workspaceId]);

  const canSaveDraft = useMemo(
    () => draftName.trim().length > 0 && draftCommand.trim().length > 0,
    [draftName, draftCommand],
  );

  function persist(next: WorkspaceScript[]) {
    setScripts(next);
    saveScripts(workspaceId, next);
  }

  function addDraft() {
    if (!canSaveDraft) return;
    persist([...scripts, { id: newScriptId(), name: draftName.trim(), command: draftCommand.trim() }]);
    setDraftName("");
    setDraftCommand("");
    setAddOpen(false);
  }

  function addStarters() {
    persist(STARTER_SCRIPTS.map((s) => ({ ...s, id: newScriptId() })));
  }

  function remove(id: string) {
    persist(scripts.filter((s) => s.id !== id));
  }

  if (!loaded) {
    return <div className="px-3 py-6 text-center text-xs text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="flex flex-col min-h-0 h-full">
      <div className="flex-1 overflow-auto min-h-0">
        {scripts.length === 0 ? (
          <EmptyState onAddStarters={addStarters} onAddCustom={() => setAddOpen(true)} />
        ) : (
          <div className="py-1">
            {scripts.map((s) => (
              <ScriptItem key={s.id} script={s} onRun={() => onRun(s.command)} onDelete={() => remove(s.id)} />
            ))}
          </div>
        )}

        {addOpen && (
          <AddScriptForm
            name={draftName}
            command={draftCommand}
            onNameChange={setDraftName}
            onCommandChange={setDraftCommand}
            onSave={addDraft}
            onCancel={() => {
              setAddOpen(false);
              setDraftName("");
              setDraftCommand("");
            }}
            canSave={canSaveDraft}
          />
        )}
      </div>

      {!addOpen && scripts.length > 0 && (
        <button
          onClick={() => setAddOpen(true)}
          className="shrink-0 border-t border-border px-3 py-2 flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent/30 transition-colors"
        >
          <Plus className="h-3 w-3" />
          New script
        </button>
      )}
    </div>
  );
}

// ─── sub-components ──────────────────────────────────────────────────

function ScriptItem({
  script,
  onRun,
  onDelete,
}: {
  script: WorkspaceScript;
  onRun: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="group flex items-center gap-2 px-2 py-1.5 rounded-sm hover:bg-accent/50 transition-colors">
      <button
        onClick={onRun}
        className="shrink-0 p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        title={`Run ${script.name}`}
      >
        <Play className="h-3 w-3" fill="currentColor" />
      </button>
      <div className="flex-1 min-w-0">
        <div className="text-[12px] font-medium text-foreground truncate">{script.name}</div>
        <div className="text-[10px] font-mono text-muted-foreground/60 truncate">{script.command}</div>
      </div>
      <button
        onClick={onDelete}
        className="shrink-0 p-1 rounded opacity-0 group-hover:opacity-100 text-muted-foreground/60 hover:text-red-400 hover:bg-accent transition-all"
        title="Delete script"
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  );
}

function AddScriptForm({
  name,
  command,
  onNameChange,
  onCommandChange,
  onSave,
  onCancel,
  canSave,
}: {
  name: string;
  command: string;
  onNameChange: (v: string) => void;
  onCommandChange: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
  canSave: boolean;
}) {
  return (
    <div className="border-t border-border px-3 py-2 space-y-1.5 bg-muted/20">
      <label className="block">
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground/60">Name</span>
        <input
          autoFocus
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="e.g. install"
          className="mt-0.5 w-full text-xs bg-transparent border border-border rounded px-2 py-1 focus:outline-none focus:border-foreground/30 placeholder:text-muted-foreground/40"
        />
      </label>
      <label className="block">
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground/60">Command</span>
        <input
          value={command}
          onChange={(e) => onCommandChange(e.target.value)}
          placeholder="pnpm install"
          onKeyDown={(e) => {
            if (e.key === "Enter" && canSave) onSave();
            if (e.key === "Escape") onCancel();
          }}
          className="mt-0.5 w-full text-xs font-mono bg-transparent border border-border rounded px-2 py-1 focus:outline-none focus:border-foreground/30 placeholder:text-muted-foreground/40"
        />
      </label>
      <div className="flex items-center gap-1.5 pt-0.5">
        <button
          onClick={onSave}
          disabled={!canSave}
          className={cn(
            "flex-1 text-[11px] font-medium py-1 rounded bg-foreground text-background transition-opacity",
            canSave ? "hover:opacity-90" : "opacity-30 cursor-not-allowed",
          )}
        >
          Save
        </button>
        <button
          onClick={onCancel}
          className="px-2.5 text-[11px] font-medium py-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function EmptyState({ onAddStarters, onAddCustom }: { onAddStarters: () => void; onAddCustom: () => void }) {
  return (
    <div className="px-3 py-10 text-center">
      <p className="text-xs text-muted-foreground">No scripts yet</p>
      <p className="text-[10px] text-muted-foreground/40 mt-1 mb-4">
        Save shell commands to re-run in the workspace terminal.
      </p>
      <div className="flex flex-col gap-1.5 max-w-[220px] mx-auto">
        <button
          onClick={onAddStarters}
          className="flex items-center justify-center gap-1.5 text-[11px] font-medium py-1.5 rounded bg-foreground text-background hover:opacity-90 transition-opacity"
        >
          <Sparkles className="h-3 w-3" />
          Add pnpm starter set
        </button>
        <button
          onClick={onAddCustom}
          className="flex items-center justify-center gap-1.5 text-[11px] font-medium py-1.5 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-accent/30 transition-colors"
        >
          <Plus className="h-3 w-3" />
          Add custom script
        </button>
      </div>
    </div>
  );
}

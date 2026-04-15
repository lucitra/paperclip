/**
 * Per-workspace saved shell scripts (name + command).
 *
 * Storage: localStorage keyed by workspace id, matches existing
 * `paperclip:<namespace>:<workspaceId>` pattern used elsewhere in the UI.
 */

export interface WorkspaceScript {
  id: string;
  name: string;
  command: string;
}

const KEY = (workspaceId: string) => `paperclip:workspace-scripts:${workspaceId}`;

export function loadScripts(workspaceId: string): WorkspaceScript[] {
  if (!workspaceId) return [];
  try {
    const raw = localStorage.getItem(KEY(workspaceId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (s): s is WorkspaceScript =>
        s && typeof s.id === "string" && typeof s.name === "string" && typeof s.command === "string",
    );
  } catch {
    return [];
  }
}

export function saveScripts(workspaceId: string, scripts: WorkspaceScript[]): void {
  if (!workspaceId) return;
  try {
    localStorage.setItem(KEY(workspaceId), JSON.stringify(scripts));
  } catch {
    // quota / private mode — fail silently
  }
}

export function newScriptId(): string {
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Starter scripts suggested when a workspace has none. Covers the most common
 * JavaScript monorepo lifecycle commands. User can tweak/remove after adding.
 */
export const STARTER_SCRIPTS: Omit<WorkspaceScript, "id">[] = [
  { name: "install", command: "pnpm install" },
  { name: "dev", command: "pnpm dev" },
  { name: "build", command: "pnpm build" },
  { name: "typecheck", command: "pnpm tsc --noEmit" },
  { name: "test", command: "pnpm test" },
];

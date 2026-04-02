import { api } from "./client";

export interface WorkspaceScanResult {
  cwd: string;
  projectName: string | null;
  languages: string[];
  configFiles: string[];
  gitRemoteUrl: string | null;
  gitDefaultBranch: string | null;
  readmeExcerpt: string | null;
  topLevelEntries: string[];
}

export const workspaceApi = {
  scan: (cwd: string) =>
    api.post<WorkspaceScanResult>("/workspace/scan", { cwd }),
};

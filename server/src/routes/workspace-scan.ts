import { Router } from "express";
import { stat, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

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

const CONFIG_FILE_LANGUAGES: Record<string, string> = {
  "package.json": "TypeScript/JavaScript",
  "tsconfig.json": "TypeScript",
  "Cargo.toml": "Rust",
  "go.mod": "Go",
  "pyproject.toml": "Python",
  "setup.py": "Python",
  "requirements.txt": "Python",
  "Gemfile": "Ruby",
  "build.gradle": "Java/Kotlin",
  "pom.xml": "Java",
  "CMakeLists.txt": "C/C++",
  "Package.swift": "Swift",
  "mix.exs": "Elixir",
  "pubspec.yaml": "Dart/Flutter",
  "composer.json": "PHP",
  "Makefile": "Make",
  "Dockerfile": "Docker",
  "docker-compose.yml": "Docker",
  "docker-compose.yaml": "Docker",
  "terraform.tf": "Terraform",
  "main.tf": "Terraform",
};

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function detectProjectName(cwd: string, configFiles: string[]): Promise<string | null> {
  if (configFiles.includes("package.json")) {
    try {
      const raw = await readFile(join(cwd, "package.json"), "utf-8");
      const pkg = JSON.parse(raw);
      if (typeof pkg.name === "string" && pkg.name) return pkg.name;
    } catch { /* ignore */ }
  }
  if (configFiles.includes("Cargo.toml")) {
    try {
      const raw = await readFile(join(cwd, "Cargo.toml"), "utf-8");
      const match = raw.match(/^\s*name\s*=\s*"([^"]+)"/m);
      if (match) return match[1];
    } catch { /* ignore */ }
  }
  if (configFiles.includes("go.mod")) {
    try {
      const raw = await readFile(join(cwd, "go.mod"), "utf-8");
      const match = raw.match(/^module\s+(\S+)/m);
      if (match) return match[1];
    } catch { /* ignore */ }
  }
  if (configFiles.includes("pyproject.toml")) {
    try {
      const raw = await readFile(join(cwd, "pyproject.toml"), "utf-8");
      const match = raw.match(/^\s*name\s*=\s*"([^"]+)"/m);
      if (match) return match[1];
    } catch { /* ignore */ }
  }
  return null;
}

async function getGitRemoteUrl(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["remote", "get-url", "origin"], { cwd, timeout: 5000 });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function getGitDefaultBranch(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd, timeout: 5000 });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function readReadmeExcerpt(cwd: string): Promise<string | null> {
  const candidates = ["README.md", "readme.md", "README.txt", "README"];
  for (const name of candidates) {
    try {
      const content = await readFile(join(cwd, name), "utf-8");
      const lines = content.split("\n").slice(0, 50);
      return lines.join("\n").trim() || null;
    } catch { /* ignore */ }
  }
  return null;
}

export function workspaceScanRoutes() {
  const router = Router();

  router.post("/workspace/scan", async (req, res) => {
    const { cwd } = req.body as { cwd?: string };

    if (!cwd || typeof cwd !== "string") {
      res.status(400).json({ error: "cwd is required" });
      return;
    }

    const resolved = cwd.startsWith("~")
      ? cwd.replace("~", process.env.HOME ?? "")
      : cwd;

    try {
      const s = await stat(resolved);
      if (!s.isDirectory()) {
        res.status(400).json({ error: "Path is not a directory" });
        return;
      }
    } catch {
      res.status(400).json({ error: "Directory does not exist" });
      return;
    }

    const entries = await readdir(resolved);
    const topLevelEntries = entries
      .filter((e) => !e.startsWith(".") || e === ".github" || e === ".env.example")
      .sort();

    const configFiles: string[] = [];
    const languageSet = new Set<string>();

    for (const [file, lang] of Object.entries(CONFIG_FILE_LANGUAGES)) {
      if (await fileExists(join(resolved, file))) {
        configFiles.push(file);
        languageSet.add(lang);
      }
    }

    const [projectName, gitRemoteUrl, gitDefaultBranch, readmeExcerpt] = await Promise.all([
      detectProjectName(resolved, configFiles),
      getGitRemoteUrl(resolved),
      getGitDefaultBranch(resolved),
      readReadmeExcerpt(resolved),
    ]);

    const result: WorkspaceScanResult = {
      cwd: resolved,
      projectName,
      languages: [...languageSet],
      configFiles,
      gitRemoteUrl,
      gitDefaultBranch,
      readmeExcerpt,
      topLevelEntries,
    };

    res.json(result);
  });

  return router;
}

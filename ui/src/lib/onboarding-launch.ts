import type { Goal } from "@paperclipai/shared";
import type { WorkspaceScanResult } from "../api/workspace";

export const ONBOARDING_PROJECT_NAME = "Onboarding";

export const DEFAULT_TASK_TITLE = "Review the backlog and ask the board what to prioritize";

export const DEFAULT_TASK_DESCRIPTION = `You are the CEO — a planning and coordination agent. The board (human users) sets strategy; you organize and execute.

**Your first job is to understand what's here and ask the board what they want done.**

- Review the current backlog — read every issue, understand what exists
- Do NOT propose a strategy or create new issues. Only work from what's already in the backlog.
- Ask the board clarifying questions: What should we focus on first? Are any of these outdated? What's the highest priority?
- Once the board gives you direction, create a formal approval request via \`POST /api/companies/{companyId}/approvals\` with type \`approve_ceo_strategy\` — include your execution plan in \`payload.plan\`, what you'll do if approved in \`payload.nextStepsIfApproved\`, and how you'll adjust if rejected in \`payload.nextStepsIfRejected\`. Link this issue using the \`issueIds\` field.
- Wait for board approval before delegating or starting any work
- Hire agents only after the board approves the hiring plan`;

export function buildContextualTaskDescription(
  scan: WorkspaceScanResult | null,
): { title: string; description: string } {
  if (!scan) {
    return { title: DEFAULT_TASK_TITLE, description: DEFAULT_TASK_DESCRIPTION };
  }

  const projectLabel = scan.projectName ?? "this project";
  const langLabel = scan.languages.length > 0
    ? ` (${scan.languages.join(", ")})`
    : "";

  const lines: string[] = [
    `You are the CEO — a planning and coordination agent. Your team is working on **${projectLabel}**${langLabel}.`,
    "",
    `The workspace is at \`${scan.cwd}\`.`,
  ];

  if (scan.configFiles.length > 0) {
    lines.push(`Key files: ${scan.configFiles.join(", ")}.`);
  }

  if (scan.readmeExcerpt) {
    const excerpt = scan.readmeExcerpt.length > 500
      ? scan.readmeExcerpt.slice(0, 500) + "..."
      : scan.readmeExcerpt;
    lines.push("", "Project overview:", excerpt);
  }

  lines.push(
    "",
    "**Your first job is to understand what's here and ask the board what they want done.**",
    "",
    "- Review the backlog and codebase — understand what exists",
    "- Do NOT propose a strategy or create new issues. Only work from what's already in the backlog.",
    "- Ask the board clarifying questions: What should we focus on first? Are any of these outdated?",
    "- Once the board gives you direction, create a formal approval request via `POST /api/companies/{companyId}/approvals` with type `approve_ceo_strategy` — include your execution plan in `payload.plan`, what you'll do if approved in `payload.nextStepsIfApproved`, and how you'll adjust if rejected in `payload.nextStepsIfRejected`. Link this issue using the `issueIds` field.",
    "- Wait for board approval before delegating or starting any work",
    "- Hire agents only after the board approves the hiring plan",
  );

  const title = scan.projectName
    ? `Review ${scan.projectName} and ask the board what to prioritize`
    : "Review the backlog and ask the board what to prioritize";

  return { title, description: lines.join("\n") };
}

function goalCreatedAt(goal: Goal) {
  const createdAt = goal.createdAt instanceof Date ? goal.createdAt : new Date(goal.createdAt);
  return Number.isNaN(createdAt.getTime()) ? 0 : createdAt.getTime();
}

function pickEarliestGoal(goals: Goal[]) {
  return [...goals].sort((a, b) => goalCreatedAt(a) - goalCreatedAt(b))[0] ?? null;
}

export function selectDefaultCompanyGoalId(goals: Goal[]): string | null {
  const companyGoals = goals.filter((goal) => goal.level === "company");
  const rootGoals = companyGoals.filter((goal) => !goal.parentId);
  const activeRootGoals = rootGoals.filter((goal) => goal.status === "active");

  return (
    pickEarliestGoal(activeRootGoals)?.id ??
    pickEarliestGoal(rootGoals)?.id ??
    pickEarliestGoal(companyGoals)?.id ??
    null
  );
}

export function buildCeoTriageTask(issueCount: number, hasCto: boolean) {
  return {
    title: "Review imported issues and ask the board what to prioritize",
    description: `${issueCount} issues were imported from Linear during onboarding.

**Your first job is to understand what's here and ask the board what they want done.**

- Review each imported issue — read them carefully, understand what exists
- Do NOT propose a strategy, create new issues, or decide what's important. The board decides priorities.
- Categorize issues by department and status so the board has a clear picture
- Ask the board specific questions:
  - "Which of these are most important to you right now?"
  - "Are any of these outdated or no longer relevant?"
  - "Should I focus on a specific area first (e.g., infrastructure, platform, marketing)?"
  - "Do we need to hire any agents to handle specific areas?"
- Once the board gives you direction, create a formal approval request via \`POST /api/companies/{companyId}/approvals\` with type \`approve_ceo_strategy\`. In the payload include:
  - \`plan\`: your execution plan for what the board asked you to do
  - \`nextStepsIfApproved\`: what you will do immediately
  - \`nextStepsIfRejected\`: how you will adjust
  - Link this issue using the \`issueIds\` field
- Wait for board approval before delegating or starting any work
- Hire agents only after the board approves the hiring plan`,
  };
}

export function buildCtoKickoffTask(issueCount: number) {
  return {
    title: "Review technical issues and ask the board what to prioritize",
    description: `${issueCount} issues were imported from Linear. The CEO will delegate technical issues to you.

**Your first job is to understand the technical backlog and ask the board what they want done.**

- Review each assigned issue for clarity, scope, and feasibility
- Do NOT start work or create new issues without board approval
- Ask the board specific questions about priorities, scope, and sequencing
- Once the board gives direction, create a formal approval request via \`POST /api/companies/{companyId}/approvals\` with type \`approve_ceo_strategy\` — include your execution plan in \`payload.plan\`, next steps if approved in \`payload.nextStepsIfApproved\`, and next steps if rejected in \`payload.nextStepsIfRejected\`. Link this issue using the \`issueIds\` field.
- Wait for board approval before assigning work or hiring engineers
- Flag blockers or unclear requirements to the CEO immediately`,
  };
}

export function buildOnboardingProjectPayload(goalId: string | null) {
  return {
    name: ONBOARDING_PROJECT_NAME,
    status: "in_progress" as const,
    ...(goalId ? { goalIds: [goalId] } : {}),
  };
}

export function buildOnboardingIssuePayload(input: {
  title: string;
  description: string;
  assigneeAgentId: string;
  projectId: string;
  goalId: string | null;
  priority?: "critical" | "high" | "medium" | "low";
}) {
  const title = input.title.trim();
  const description = input.description.trim();

  return {
    title,
    ...(description ? { description } : {}),
    assigneeAgentId: input.assigneeAgentId,
    projectId: input.projectId,
    ...(input.goalId ? { goalId: input.goalId } : {}),
    ...(input.priority ? { priority: input.priority } : {}),
    status: "todo" as const,
  };
}

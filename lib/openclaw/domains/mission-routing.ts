import { randomUUID } from "node:crypto";
import { lstat, mkdir, realpath } from "node:fs/promises";
import path from "node:path";

import { DEFAULT_AGENT_PRESET, resolveAgentPolicy } from "@/lib/openclaw/agent-presets";
import { buildAgentPolicyPromptLines } from "@/lib/openclaw/domains/workspace-bootstrap";
import type { AgentPolicy, MissionSubmission } from "@/lib/openclaw/types";

export interface MissionOutputPlan {
  runFolder: string;
  absoluteOutputDir: string;
  relativeOutputDir: string;
  notesDirRelative: string;
}

function slugify(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeWorkspaceRelativePath(targetPath: string) {
  return targetPath.split(path.sep).join("/");
}

export function buildMissionOutputFolderName(mission: string) {
  const now = new Date();
  const timestamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0")
  ].join("-");
  const normalizedMission = mission.replace(/^\[[^\]]+\]\s*/i, "").trim();
  const missionSlug = slugify(normalizedMission).slice(0, 48).replace(/^-+|-+$/g, "") || "task";

  return `${timestamp}-${missionSlug}-${randomUUID()}`;
}

export async function prepareMissionOutputPlan(workspacePath: string, mission: string): Promise<MissionOutputPlan> {
  const runFolder = buildMissionOutputFolderName(mission);
  const workspaceRoot = await realpath(workspacePath);
  const outputRoot = path.join(workspaceRoot, "deliverables");
  const absoluteOutputDir = path.join(outputRoot, runFolder);
  const relativeOutputDir = normalizeWorkspaceRelativePath(path.join("deliverables", runFolder));
  const notesDirRelative = normalizeWorkspaceRelativePath("memory");

  await ensureMissionWorkspaceDirectory(outputRoot);
  await ensureMissionWorkspaceDirectory(path.join(workspaceRoot, "memory"));
  await mkdir(absoluteOutputDir);

  return {
    runFolder,
    absoluteOutputDir,
    relativeOutputDir,
    notesDirRelative
  };
}

async function ensureMissionWorkspaceDirectory(directory: string) {
  try {
    await mkdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }

  if (!(await lstat(directory)).isDirectory()) {
    throw new Error("Mission output and memory paths must be regular workspace directories.");
  }
}

export function composeMissionWithOutputRouting(
  mission: string,
  outputPlan: Pick<MissionOutputPlan, "relativeOutputDir" | "notesDirRelative">,
  policy?: AgentPolicy,
  setupAgentId?: string | null,
  workspaceSurfacePrompt?: string | null,
  currentAgent?: { id: string; name?: string | null } | null,
  intent?: Pick<MissionSubmission, "expectedOutcome" | "acceptanceCriteria">
) {
  const resolvedPolicy = policy ?? resolveAgentPolicy(DEFAULT_AGENT_PRESET);
  const agentContextLines = currentAgent
    ? [
        "Agent workspace context:",
        `- Your current OpenClaw agent id is \`${currentAgent.id}\`${currentAgent.name ? ` and your AgentOS display name is ${currentAgent.name}` : ""}.`,
        "- Use your assigned OpenClaw skills, including the AgentOS policy skill, for agent-specific behavior and policy.",
        "- Use the `AGENTS.md` Team section to identify teammates; it is shared workspace context, not a persona store.",
        "- Use root `AGENTS.md`, `SOUL.md`, `USER.md`, `MEMORY.md`, `memory/*.md`, and `docs/*.md` as shared workspace/project context."
      ]
    : [];

  return [
    mission,
    ...(agentContextLines.length > 0 ? ["", ...agentContextLines] : []),
    "",
    "Task output routing:",
    `- Put substantial outputs, drafts, reports, docs, and file deliverables under \`${outputPlan.relativeOutputDir}/\`.`,
    `- If a file is requested, default to \`${outputPlan.relativeOutputDir}/<descriptive-file-name>\` unless the user explicitly asks for another path.`,
    `- Use \`${outputPlan.notesDirRelative}/\` only for temporary notes or durable workspace memory, not final deliverables.`,
    "- Avoid writing final artifacts to the workspace root.",
    "- Before reporting a file as delivered, check that it exists, contains the expected content, and can be used. Report its workspace-relative path.",
    "- Summarize the outcome, its evidence, material assumptions, and any unfinished work or conditions you could not verify.",
    "- Only update shared workspace docs when the change is durable and workspace-wide; task-specific docs should stay inside this run folder.",
    ...(intent?.expectedOutcome ? ["", "Expected outcome:", intent.expectedOutcome] : []),
    ...(intent?.acceptanceCriteria ? ["", "Acceptance criteria:", intent.acceptanceCriteria] : []),
    "",
    "Agent operating policy:",
    ...buildAgentPolicyPromptLines(resolvedPolicy, setupAgentId),
    ...(workspaceSurfacePrompt ? ["", workspaceSurfacePrompt] : [])
  ].join("\n");
}

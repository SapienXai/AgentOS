import "server-only";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { redactSecretText } from "@/lib/security/redaction";
import { resolveAgentPolicy } from "@/lib/openclaw/agent-presets";
import { createAgent } from "@/lib/openclaw/application/agent-service";
import { getMissionControlSnapshot } from "@/lib/openclaw/application/mission-control-service";
import { createWorkspaceProject } from "@/lib/openclaw/application/workspace-service";
import {
  readWorkspaceProjectManifest,
  serializeWorkspaceProjectManifestRecord,
  type WorkspaceProjectManifest
} from "@/lib/openclaw/domains/workspace-manifest";
import type {
  AgentCreateInput,
  MissionControlSnapshot,
  PlannerAdvisorId,
  WorkspaceAgentBlueprintInput,
  WorkspaceCreateInput,
  WorkspaceCreateResult
} from "@/lib/openclaw/types";

export const PLANNER_RUNTIME_WORKSPACE_PATH = path.join(
  /*turbopackIgnore: true*/ process.cwd(),
  ".mission-control",
  "planner",
  "runtime-workspace"
);
export const PLANNER_RUNTIME_NAME = "AgentOS Planner Runtime";
export const PLANNER_RUNTIME_SYSTEM_TAG = "mission-control-planner";

export type PlannerRuntimeRole = PlannerAdvisorId;
export const PLANNER_RUNTIME_ADVISOR_ORDER: Exclude<PlannerRuntimeRole, "architect">[] = [
  "founder",
  "product",
  "ops",
  "growth",
  "reviewer"
];

export type PlannerRuntimeFailureKind = "none" | "gateway" | "authorization" | "runtime-bootstrap";
export type PlannerRuntimeStatus = "ready" | "missing" | "partial" | "degraded" | "unavailable";

export type PlannerRuntimeEnsureDependencies = {
  getSnapshot: (options: { force?: boolean; includeHidden?: boolean }) => Promise<Pick<MissionControlSnapshot, "workspaces" | "agents">>;
  createWorkspaceProject: (input: WorkspaceCreateInput) => Promise<WorkspaceCreateResult>;
  createAgent: (input: AgentCreateInput) => Promise<unknown>;
  readManifest: (workspacePath: string) => Promise<WorkspaceProjectManifest>;
  configureWorkspace: (workspacePath: string, roles: PlannerRuntimeRole[]) => Promise<void>;
};

export type PlannerRuntimeEnsureOptions = {
  includeAdvisors?: boolean;
  dependencies?: PlannerRuntimeEnsureDependencies;
};

export type PlannerRuntimeEnsureResult = {
  status: PlannerRuntimeStatus;
  workspaceId: string | null;
  workspacePath: string | null;
  architectAgentId: string | null;
  advisorAgentIds: Partial<Record<Exclude<PlannerRuntimeRole, "architect">, string>>;
  failureKind: PlannerRuntimeFailureKind;
  warning: string | null;
  repaired: boolean;
};

export const PLANNER_RUNTIME_ARCHITECT_AGENT_ID = buildPlannerRuntimeAgentId("architect");

const plannerRuntimeAgentBlueprints: Record<PlannerRuntimeRole, WorkspaceAgentBlueprintInput> = {
  architect: {
    id: "architect",
    role: "Workspace Architect",
    name: "Workspace Architect",
    enabled: true,
    isPrimary: true,
    emoji: "🤖",
    theme: "cyan",
    skillId: "planner-architect",
    policy: resolveAgentPolicy("worker", {
      fileAccess: "workspace-only",
      networkAccess: "enabled"
    }),
    heartbeat: { enabled: false }
  },
  founder: {
    id: "founder",
    role: "Founder",
    name: "Founder",
    enabled: true,
    emoji: "🏗️",
    theme: "amber",
    skillId: "planner-founder",
    policy: resolveAgentPolicy("worker", {
      fileAccess: "workspace-only",
      networkAccess: "enabled"
    }),
    heartbeat: { enabled: false }
  },
  product: {
    id: "product",
    role: "Product Lead",
    name: "Product Lead",
    enabled: true,
    emoji: "📐",
    theme: "emerald",
    skillId: "planner-product",
    policy: resolveAgentPolicy("worker", {
      fileAccess: "workspace-only",
      networkAccess: "enabled"
    }),
    heartbeat: { enabled: false }
  },
  ops: {
    id: "ops",
    role: "Operations",
    name: "Operations",
    enabled: true,
    emoji: "⚙️",
    theme: "blue",
    skillId: "planner-ops",
    policy: resolveAgentPolicy("worker", {
      fileAccess: "workspace-only",
      networkAccess: "enabled"
    }),
    heartbeat: { enabled: false }
  },
  growth: {
    id: "growth",
    role: "Growth",
    name: "Growth",
    enabled: true,
    emoji: "📣",
    theme: "violet",
    skillId: "planner-growth",
    policy: resolveAgentPolicy("worker", {
      fileAccess: "workspace-only",
      networkAccess: "enabled"
    }),
    heartbeat: { enabled: false }
  },
  reviewer: {
    id: "reviewer",
    role: "Reviewer",
    name: "Reviewer",
    enabled: true,
    emoji: "🔍",
    theme: "rose",
    skillId: "planner-reviewer",
    policy: resolveAgentPolicy("worker", {
      fileAccess: "workspace-only",
      networkAccess: "enabled"
    }),
    heartbeat: { enabled: false }
  }
};

const plannerRuntimeSkillContents: Record<string, string> = {
  "planner-architect": `# Workspace Architect

You are the primary planning agent for AgentOS.

## Mission
- Understand the operator's intent through conversation.
- Draft a complete, revisable workspace plan proactively.
- Ask questions only when no safe default exists and the workspace cannot stay coherent without one.

## Output Contract
- Always return valid JSON only.
- Never wrap JSON in markdown fences.
- Use this schema:
{
  "reply": "short natural language response to the operator",
  "mode": "guided | advanced | null",
  "reviewRequested": boolean,
  "assumptions": ["assumption you took proactively"],
  "suggestions": ["recommended next move or stronger default"],
  "questions": ["only if a decision would materially change the design"],
  "patch": {}
}

## Rules
- Keep momentum. Prefer a complete draft over hesitation.
- Keep the reply concise and specific, but make the patch rich and complete.
- Treat natural language as enough. Do not wait for rigid field-by-field phrasing.
- Treat the latest user message as either a fresh brief or a revision instruction against the current draft.
- Rewrite any section the operator wants changed and refresh dependent sections in the same patch.
- Prefer website title and domain evidence over raw action phrases when inferring names.
- Never derive a company or workspace name from generic intent text like "workspace kurmak istiyorum" or similar action phrasing.
- If the message includes a proper noun tied to the project, workspace, or brand, treat it as a valid name candidate unless contradicted.
- When the operator names the company or workspace explicitly, apply it immediately.
- If the operator asks for a role in plain language, create or adapt a persistent agent for that role.
- Example: if the operator says "şahsi asistan ekleyelim" or "add a personal assistant", add a persistent agent like { id: "personal-assistant", role: "Personal Assistant", name: "Personal Assistant", ... }.
- Infer likely defaults and say what you assumed instead of bouncing the decision back by default.
- Give proactive suggestions when you see a stronger workspace shape, cleaner V1, or better agent split.
- If the operator asks to rewrite a generated document, update workspace.docOverrides for that document path and keep unrelated plan sections unchanged.
- Use patch as the source of truth. The planner layer should validate the draft, not force the operator to restate it.
- When a domain or website implies a likely brand name, use it unless contradicted.
- If a section must be removed in a revision, use the relevant removeIds list for agents, workflows, channels, automations, or hooks.
- Change only the canonical workspace.materialization object when the physical starting point changes; its mode and fields must remain a valid combination.
- Add or remove knowledge.sources independently. Changing workspace.materialization must not delete unrelated knowledge.sources, and changing knowledge.sources must not mutate workspace.materialization.
- Treat AgentOS as the source of truth. Patch only the fields that should change.
`,
  "planner-founder": `# Founder Advisor

Return valid JSON only:
{
  "summary": "commercial read",
  "recommendations": ["..."],
  "concerns": ["..."]
}

Focus on mission clarity, audience, value exchange, and launch posture. Be concise.`,
  "planner-product": `# Product Lead

Return valid JSON only:
{
  "summary": "product read",
  "recommendations": ["..."],
  "concerns": ["..."]
}

Focus on offer, V1 scope, non-goals, and operator experience. Be concise.`,
  "planner-ops": `# Operations Advisor

Return valid JSON only:
{
  "summary": "operations read",
  "recommendations": ["..."],
  "concerns": ["..."]
}

Focus on workflows, automations, channels, run cadence, and reliability. Be concise.`,
  "planner-growth": `# Growth Advisor

Return valid JSON only:
{
  "summary": "growth read",
  "recommendations": ["..."],
  "concerns": ["..."]
}

Focus on acquisition loops, activation, community, and measurable signals. Be concise.`,
  "planner-reviewer": `# Reviewer

Return valid JSON only:
{
  "summary": "risk read",
  "recommendations": ["..."],
  "concerns": ["..."]
}

Pressure-test assumptions, missing info, hidden blockers, and design regressions. Be concise.`
};

const defaultDependencies: PlannerRuntimeEnsureDependencies = {
  getSnapshot: getMissionControlSnapshot,
  createWorkspaceProject,
  createAgent,
  readManifest: readWorkspaceProjectManifest,
  configureWorkspace: configurePlannerRuntimeWorkspace
};

const inFlightEnsures = new WeakMap<object, Map<boolean, Promise<PlannerRuntimeEnsureResult>>>();

export async function ensureWorkspaceArchitectRuntime(
  options: PlannerRuntimeEnsureOptions = {}
): Promise<PlannerRuntimeEnsureResult> {
  return ensureAgentOsPlannerRuntime({ ...options, includeAdvisors: false });
}

export async function ensureAgentOsPlannerRuntime(
  options: PlannerRuntimeEnsureOptions = {}
): Promise<PlannerRuntimeEnsureResult> {
  const dependencies = options.dependencies ?? defaultDependencies;
  const includeAdvisors = options.includeAdvisors === true;
  let scopedPromises = inFlightEnsures.get(dependencies);
  if (!scopedPromises) {
    scopedPromises = new Map();
    inFlightEnsures.set(dependencies, scopedPromises);
  }
  const existing = scopedPromises.get(includeAdvisors);
  if (existing) return existing;

  const promise = ensurePlannerRuntimeInternal(dependencies, includeAdvisors).finally(() => {
    if (scopedPromises?.get(includeAdvisors) === promise) scopedPromises.delete(includeAdvisors);
  });
  scopedPromises.set(includeAdvisors, promise);
  return promise;
}

async function ensurePlannerRuntimeInternal(
  dependencies: PlannerRuntimeEnsureDependencies,
  includeAdvisors: boolean
): Promise<PlannerRuntimeEnsureResult> {
  const roles: PlannerRuntimeRole[] = includeAdvisors
    ? ["architect", ...PLANNER_RUNTIME_ADVISOR_ORDER]
    : ["architect"];
  let snapshot: Pick<MissionControlSnapshot, "workspaces" | "agents">;
  let workspace: Pick<MissionControlSnapshot, "workspaces">["workspaces"][number] | null = null;
  let repaired = false;

  try {
    snapshot = await dependencies.getSnapshot({ force: true, includeHidden: true });
    workspace = snapshot.workspaces.find((entry) => entry.path === PLANNER_RUNTIME_WORKSPACE_PATH) ?? null;
    if (!workspace) {
      const created = await dependencies.createWorkspaceProject({
        name: PLANNER_RUNTIME_NAME,
        directory: PLANNER_RUNTIME_WORKSPACE_PATH,
        sourceMode: "empty",
        template: "research",
        teamPreset: "custom",
        modelProfile: "balanced",
        rules: {
          workspaceOnly: true,
          generateStarterDocs: false,
          generateMemory: false,
          kickoffMission: false
        },
        agents: roles.map((role) => plannerRuntimeAgentBlueprints[role]),
        creation: {
          source: "planner-runtime",
          idempotencyKey: "agentos-planner-runtime"
        }
      });
      repaired = true;
      snapshot = await dependencies.getSnapshot({ force: true, includeHidden: true });
      workspace = snapshot.workspaces.find((entry) =>
        entry.path === PLANNER_RUNTIME_WORKSPACE_PATH || entry.id === created.workspaceId
      ) ?? null;
    }

    if (!workspace) {
      return unavailableResult("The hidden AgentOS Architect runtime workspace was not found after provisioning.", false);
    }

    const manifest = await dependencies.readManifest(workspace.path);
    if (manifest.hidden !== true || manifest.systemTag !== PLANNER_RUNTIME_SYSTEM_TAG) {
      await dependencies.configureWorkspace(workspace.path, roles);
      repaired = true;
    }

    snapshot = await dependencies.getSnapshot({ force: true, includeHidden: true });
    workspace = snapshot.workspaces.find((entry) => entry.id === workspace?.id || entry.path === PLANNER_RUNTIME_WORKSPACE_PATH) ?? workspace;
    const existingAgentIds = new Set(
      snapshot.agents.filter((agent) => agent.workspaceId === workspace?.id).map((agent) => agent.id)
    );

    for (const role of roles) {
      const expectedAgentId = buildPlannerRuntimeAgentId(role);
      if (existingAgentIds.has(expectedAgentId)) continue;
      await dependencies.createAgent({
        id: expectedAgentId,
        workspaceId: workspace.id,
        workspacePath: workspace.path,
        name: plannerRuntimeAgentBlueprints[role].name,
        emoji: plannerRuntimeAgentBlueprints[role].emoji,
        theme: plannerRuntimeAgentBlueprints[role].theme,
        policy: plannerRuntimeAgentBlueprints[role].policy,
        heartbeat: plannerRuntimeAgentBlueprints[role].heartbeat
      });
      repaired = true;
    }

    await dependencies.configureWorkspace(workspace.path, roles);
    snapshot = await dependencies.getSnapshot({ force: true, includeHidden: true });
    const finalWorkspace = snapshot.workspaces.find((entry) =>
      entry.id === workspace?.id || entry.path === PLANNER_RUNTIME_WORKSPACE_PATH
    ) ?? workspace;
    const finalAgentIds = new Set(
      snapshot.agents.filter((agent) => agent.workspaceId === finalWorkspace.id).map((agent) => agent.id)
    );
    const missingRoles = roles.filter((role) => !finalAgentIds.has(buildPlannerRuntimeAgentId(role)));
    if (missingRoles.length > 0) {
      return {
        status: "partial",
        workspaceId: finalWorkspace.id,
        workspacePath: finalWorkspace.path,
        architectAgentId: finalAgentIds.has(PLANNER_RUNTIME_ARCHITECT_AGENT_ID) ? PLANNER_RUNTIME_ARCHITECT_AGENT_ID : null,
        advisorAgentIds: buildAdvisorAgentIds(finalAgentIds),
        failureKind: "runtime-bootstrap",
        warning: `The hidden AgentOS Architect runtime is incomplete: ${missingRoles.join(", ")}.`,
        repaired
      };
    }

    return {
      status: "ready",
      workspaceId: finalWorkspace.id,
      workspacePath: finalWorkspace.path,
      architectAgentId: PLANNER_RUNTIME_ARCHITECT_AGENT_ID,
      advisorAgentIds: buildAdvisorAgentIds(finalAgentIds),
      failureKind: "none",
      warning: null,
      repaired
    };
  } catch (error) {
    const failureKind = classifyRuntimeFailure(error);
    const detail = sanitizeRuntimeError(error);
    return {
      status: workspace ? "degraded" : "unavailable",
      workspaceId: workspace?.id ?? null,
      workspacePath: workspace?.path ?? null,
      architectAgentId: null,
      advisorAgentIds: {},
      failureKind,
      warning: `The hidden AgentOS Architect runtime is unavailable. ${detail}`,
      repaired
    };
  }
}

function buildAdvisorAgentIds(agentIds: Set<string>) {
  return Object.fromEntries(
    PLANNER_RUNTIME_ADVISOR_ORDER
      .filter((role) => agentIds.has(buildPlannerRuntimeAgentId(role)))
      .map((role) => [role, buildPlannerRuntimeAgentId(role)])
  ) as Partial<Record<Exclude<PlannerRuntimeRole, "architect">, string>>;
}

function unavailableResult(warning: string, repaired: boolean): PlannerRuntimeEnsureResult {
  return {
    status: "unavailable",
    workspaceId: null,
    workspacePath: null,
    architectAgentId: null,
    advisorAgentIds: {},
    failureKind: "runtime-bootstrap",
    warning,
    repaired
  };
}

function classifyRuntimeFailure(error: unknown): PlannerRuntimeFailureKind {
  const message = error instanceof Error ? error.message : String(error);
  if (/unauthori[sz]|forbidden|permission|not allowed|access denied/i.test(message)) return "authorization";
  if (/gateway|websocket|connection|openclaw.*unavailable|runtime.*not ready/i.test(message)) return "gateway";
  return "runtime-bootstrap";
}

function sanitizeRuntimeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return redactSecretText(message).replace(/\s+/g, " ").trim().slice(0, 240) || "Provisioning did not complete.";
}

export function buildPlannerRuntimeAgentId(agentKey: string) {
  return `${slugify(PLANNER_RUNTIME_NAME)}-${slugify(agentKey) || "agent"}`;
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

async function configurePlannerRuntimeWorkspace(workspacePath: string, roles: PlannerRuntimeRole[]) {
  await mkdir(path.join(workspacePath, "skills"), { recursive: true });

  const skillIds = new Set(roles.map((role) => plannerRuntimeAgentBlueprints[role].skillId).filter(Boolean));
  for (const skillId of skillIds) {
    const contents = plannerRuntimeSkillContents[skillId ?? ""];
    if (!contents) continue;
    const skillPath = path.join(workspacePath, "skills", skillId ?? "", "SKILL.md");
    await mkdir(path.dirname(skillPath), { recursive: true });
    await writeFile(skillPath, `${contents.trim()}\n`, "utf8");
  }

  const projectFilePath = path.join(workspacePath, ".openclaw", "project.json");
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(await readFile(projectFilePath, "utf8")) as Record<string, unknown>;
  } catch {
    parsed = {};
  }

  const serialized = serializeWorkspaceProjectManifestRecord(parsed, {
    name: typeof parsed.name === "string" ? parsed.name : PLANNER_RUNTIME_NAME,
    hidden: true,
    systemTag: PLANNER_RUNTIME_SYSTEM_TAG,
    updatedAt: new Date().toISOString()
  });
  await mkdir(path.dirname(projectFilePath), { recursive: true });
  await writeFile(projectFilePath, `${JSON.stringify(serialized, null, 2)}\n`, "utf8");
}

export function getPlannerRuntimeAgentBlueprints(includeAdvisors = false) {
  const roles: PlannerRuntimeRole[] = includeAdvisors
    ? ["architect", ...PLANNER_RUNTIME_ADVISOR_ORDER]
    : ["architect"];
  return roles.map((role) => structuredClone(plannerRuntimeAgentBlueprints[role]));
}

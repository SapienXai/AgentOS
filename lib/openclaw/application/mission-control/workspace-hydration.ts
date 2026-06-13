import "server-only";

import { buildSnapshotAgentEntry } from "@/lib/openclaw/adapter/agent-snapshot-adapter";
import { readAgentBootstrapProfile } from "@/lib/openclaw/adapter/agent-profile-adapter";
import {
  buildWorkspaceBootstrapProfileCache,
  readWorkspaceInspectorMetadata,
  type WorkspaceBootstrapProfileCache
} from "@/lib/openclaw/adapter/workspace-inspector-adapter";
import { buildWorkspaceProjectEntry } from "@/lib/openclaw/adapter/workspace-snapshot-adapter";
import type {
  AgentConfigPayload,
  AgentPayload,
  GatewayStatusPayload,
  StatusPayload
} from "@/lib/openclaw/client/gateway-client";
import { filterAgentPolicySkills } from "@/lib/openclaw/domains/agent-config";
import { sortRuntimesByUpdatedAtDesc } from "@/lib/openclaw/domains/runtime-history";
import type { SessionsPayload } from "@/lib/openclaw/domains/session-catalog";
import {
  reconcileWorkspaceProjectManifestAgents,
  readWorkspaceProjectManifest,
  type WorkspaceProjectManifest
} from "@/lib/openclaw/domains/workspace-manifest";
import { syncWorkspaceAgentsMarkdown } from "@/lib/openclaw/domains/workspace-agents-document-sync";
import { createWorkspaceIdResolver } from "@/lib/openclaw/domains/workspace-id";
import { DEFAULT_WORKSPACE_RULES } from "@/lib/openclaw/workspace-presets";
import type {
  OpenClawAgent,
  RelationshipRecord,
  RuntimeRecord,
  WorkspaceProject
} from "@/lib/openclaw/types";
import {
  createEmptyWorkspace,
  uniqueStrings
} from "@/lib/openclaw/application/mission-control/snapshot-utils";

export type MissionControlWorkspaceBindings = {
  workspaceBoundAgents: Array<AgentPayload[number] & { workspace: string }>;
  workspacePaths: string[];
  activeAgentIdsByWorkspacePath: Map<string, string[]>;
  resolveWorkspaceId: (workspacePath: string) => string;
};

export function createMissionControlWorkspaceBindings(agentsList: AgentPayload): MissionControlWorkspaceBindings {
  const workspaceBoundAgents = agentsList.filter(
    (agent): agent is AgentPayload[number] & { workspace: string } => Boolean(agent.workspace)
  );
  const workspacePaths = Array.from(new Set(workspaceBoundAgents.map((agent) => agent.workspace)));
  const activeAgentIdsByWorkspacePath = new Map<string, string[]>();

  for (const agent of workspaceBoundAgents) {
    const agentIds = activeAgentIdsByWorkspacePath.get(agent.workspace) ?? [];
    agentIds.push(agent.id);
    activeAgentIdsByWorkspacePath.set(agent.workspace, agentIds);
  }

  return {
    workspaceBoundAgents,
    workspacePaths,
    activeAgentIdsByWorkspacePath,
    resolveWorkspaceId: createWorkspaceIdResolver(workspacePaths)
  };
}

export async function hydrateMissionControlWorkspaceGraph(input: {
  bindings: MissionControlWorkspaceBindings;
  agentConfig: AgentConfigPayload;
  sessions: SessionsPayload["sessions"];
  status?: StatusPayload;
  gatewayStatus?: GatewayStatusPayload;
  hasOpenClawSignal: boolean;
  runtimes: RuntimeRecord[];
}) {
  const workspaceByPath = new Map<string, WorkspaceProject>();
  const manifestByWorkspace = new Map<string, WorkspaceProjectManifest>();
  const workspaceBootstrapProfileByWorkspace = new Map<string, WorkspaceBootstrapProfileCache>();
  const agents: OpenClawAgent[] = [];
  const relationships: RelationshipRecord[] = [];

  const heartbeatByAgent = new Map(
    (input.status?.heartbeat?.agents ?? []).map((entry) => [entry.agentId, entry])
  );
  const configByAgent = new Map(input.agentConfig.map((entry) => [entry.id, entry]));
  const recentSessionsByAgent = new Map<string, SessionsPayload["sessions"]>();

  for (const session of input.sessions) {
    if (!session.agentId) {
      continue;
    }

    const list = recentSessionsByAgent.get(session.agentId) ?? [];
    list.push(session);
    recentSessionsByAgent.set(session.agentId, list);
  }

  await Promise.all(
    input.bindings.workspacePaths.map(async (workspacePath) => {
      const activeAgentIds = input.bindings.activeAgentIdsByWorkspacePath.get(workspacePath) ?? [];
      const manifest = await reconcileWorkspaceProjectManifestAgents(workspacePath, activeAgentIds);
      await syncWorkspaceAgentsMarkdown(workspacePath);
      manifestByWorkspace.set(workspacePath, manifest);
      workspaceBootstrapProfileByWorkspace.set(
        workspacePath,
        await buildWorkspaceBootstrapProfileCache(
          workspacePath,
          manifest.template,
          manifest.rules ?? DEFAULT_WORKSPACE_RULES
        )
      );
    })
  );

  const agentEntries = await Promise.all(
    input.bindings.workspaceBoundAgents.map(async (rawAgent) => {
      const configured = configByAgent.get(rawAgent.id);
      const identityOverrides = configured?.identity
        ? {
            name: configured.identity.name ?? configured.name ?? null,
            emoji: configured.identity.emoji ?? null,
            theme: configured.identity.theme ?? null,
            avatar: configured.identity.avatar ?? null
          }
        : configured?.name
          ? {
              name: configured.name,
              emoji: null,
              theme: null,
              avatar: null
            }
          : null;
      const workspaceId = input.bindings.resolveWorkspaceId(rawAgent.workspace);
      const sessionList = recentSessionsByAgent.get(rawAgent.id) ?? [];
      const manifest =
        manifestByWorkspace.get(rawAgent.workspace) ??
        (await readWorkspaceProjectManifest(rawAgent.workspace));
      manifestByWorkspace.set(rawAgent.workspace, manifest);
      const manifestAgent = manifest.agents.find((entry) => entry.id === rawAgent.id) ?? null;
      const profile = await readAgentBootstrapProfile(rawAgent.workspace, {
        agentId: rawAgent.id,
        agentName:
          configured?.name ||
          rawAgent.name ||
          configured?.identity?.name ||
          rawAgent.identityName ||
          rawAgent.id,
        configuredSkills: filterAgentPolicySkills(configured?.skills ?? []),
        configuredTools: uniqueStrings([
          ...(manifestAgent?.toolIds ?? []),
          ...((configured?.tools?.fs?.workspaceOnly || manifestAgent?.policy?.fileAccess === "workspace-only")
            ? ["fs.workspaceOnly"]
            : [])
        ]),
        template: manifest.template,
        rules: manifest.rules ?? DEFAULT_WORKSPACE_RULES,
        workspaceBootstrapProfile:
          workspaceBootstrapProfileByWorkspace.get(rawAgent.workspace) ??
          (await buildWorkspaceBootstrapProfileCache(
            rawAgent.workspace,
            manifest.template,
            manifest.rules ?? DEFAULT_WORKSPACE_RULES
          ))
      });
      const agentRuntimes = input.runtimes
        .filter((runtime) => runtime.agentId === rawAgent.id)
        .sort(sortRuntimesByUpdatedAtDesc);
      const heartbeat = heartbeatByAgent.get(rawAgent.id) ?? (
        configured?.heartbeat?.every
          ? {
              enabled: true,
              every: configured.heartbeat.every,
              everyMs: null
            }
          : null
      );
      return buildSnapshotAgentEntry({
        rawAgent,
        configured,
        identityOverrides,
        workspaceId,
        sessionList,
        manifestAgent,
        agentRuntimes,
        gatewayRpcOk: Boolean(input.gatewayStatus?.rpc?.ok || input.hasOpenClawSignal),
        heartbeat,
        profile
      });
    })
  );

  for (const entry of agentEntries) {
    const workspace = ensureWorkspace(
      workspaceByPath,
      entry.workspacePath,
      input.bindings.resolveWorkspaceId
    );
    workspace.agentIds.push(entry.agent.id);
    workspace.modelIds.push(entry.primaryModel);
    workspace.activeRuntimeIds.push(...entry.activeRuntimeIds);
    workspace.totalSessions += entry.sessionCount;
    agents.push(entry.agent);
    relationships.push(...entry.relationships);
  }

  attachRuntimeWorkspaceSignals(workspaceByPath, input.runtimes, input.bindings.resolveWorkspaceId);

  const agentsByWorkspace = new Map<string, OpenClawAgent[]>();
  for (const agent of agents) {
    const list = agentsByWorkspace.get(agent.workspaceId) ?? [];
    list.push(agent);
    agentsByWorkspace.set(agent.workspaceId, list);
  }

  const workspaces = await Promise.all(
    Array.from(workspaceByPath.values()).map(async (workspace) => {
      const workspaceAgents = agentsByWorkspace.get(workspace.id) ?? [];
      const manifest = manifestByWorkspace.get(workspace.path) ?? null;
      const metadata = await readWorkspaceInspectorMetadata(
        workspace.path,
        workspaceAgents,
        manifest ?? undefined
      );

      return buildWorkspaceProjectEntry({
        workspace,
        manifest,
        metadata,
        allAgents: agents
      });
    })
  );

  return {
    workspaces,
    agents,
    relationships,
    manifestByWorkspace
  };
}

function ensureWorkspace(
  store: Map<string, WorkspaceProject>,
  workspacePath: string,
  resolveWorkspaceId: (workspacePath: string) => string
) {
  const workspaceId = resolveWorkspaceId(workspacePath);
  const existing = store.get(workspaceId);

  if (existing) {
    return existing;
  }

  const workspace = createEmptyWorkspace(workspacePath, resolveWorkspaceId);

  store.set(workspaceId, workspace);
  return workspace;
}

function attachRuntimeWorkspaceSignals(
  store: Map<string, WorkspaceProject>,
  runtimes: RuntimeRecord[],
  resolveWorkspaceId: (workspacePath: string) => string
) {
  const runtimeSessionIdsByWorkspaceId = new Map<string, Set<string>>();

  for (const runtime of runtimes) {
    const workspacePath = runtime.workspacePath?.trim();

    if (!workspacePath) {
      continue;
    }

    const workspace = ensureWorkspaceForRuntime(store, runtime, workspacePath, resolveWorkspaceId);
    workspace.activeRuntimeIds.push(runtime.id);

    if (runtime.modelId) {
      workspace.modelIds.push(runtime.modelId);
    }

    if (runtime.sessionId && workspace.agentIds.length === 0) {
      const sessionIds = runtimeSessionIdsByWorkspaceId.get(workspace.id) ?? new Set<string>();
      sessionIds.add(runtime.sessionId);
      runtimeSessionIdsByWorkspaceId.set(workspace.id, sessionIds);
    }
  }

  for (const [workspaceId, sessionIds] of runtimeSessionIdsByWorkspaceId) {
    const workspace = store.get(workspaceId);

    if (workspace && workspace.agentIds.length === 0) {
      workspace.totalSessions = sessionIds.size;
    }
  }
}

function ensureWorkspaceForRuntime(
  store: Map<string, WorkspaceProject>,
  runtime: RuntimeRecord,
  workspacePath: string,
  resolveWorkspaceId: (workspacePath: string) => string
) {
  const workspaceId = runtime.workspaceId?.trim() || resolveWorkspaceId(workspacePath);
  const existing = store.get(workspaceId);

  if (existing) {
    return existing;
  }

  const workspace = createEmptyWorkspace(workspacePath, () => workspaceId);
  store.set(workspaceId, workspace);
  return workspace;
}

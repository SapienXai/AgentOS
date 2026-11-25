import "server-only";

import { buildAgentPayloadsFromGatewayList } from "@/lib/openclaw/adapter/agent-adapter";
import { buildSnapshotAgentEntry } from "@/lib/openclaw/adapter/agent-snapshot-adapter";
import { getOpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import { createEmptyWorkspace } from "@/lib/openclaw/application/mission-control/snapshot-utils";
import { createMissionControlWorkspaceBindings } from "@/lib/openclaw/application/mission-control/workspace-hydration";
import { resolveGatewayUrl } from "@/lib/openclaw/client/native-ws-gateway-policy";
import { readWorkspaceProjectManifest } from "@/lib/openclaw/domains/workspace-manifest";
import { createLoadingSnapshot } from "@/lib/openclaw/fallback";
import { getOpenClawStateRootPath } from "@/lib/openclaw/state/paths";
import { isLoopbackHost } from "@/lib/security/local-operator";

const INITIAL_INVENTORY_TIMEOUT_MS = 750;

/** Read only the initial visible roster. Full diagnostics and activity come from the existing snapshot stream. */
export async function loadMissionControlInventory() {
  const snapshot = createLoadingSnapshot("Loading OpenClaw runtime activity.");
  if (!isLoopbackHost(new URL(resolveGatewayUrl()).host)) return snapshot;
  const adapter = getOpenClawAdapter();
  const payload = await adapter.listAgents({ timeoutMs: INITIAL_INVENTORY_TIMEOUT_MS, allowCliFallback: false });
  // Do not infer workspace paths for remote or partial native records.
  const nativeAgents = { ...payload, agents: payload.agents.filter(({ workspace }) => Boolean(workspace?.trim())) };
  const bindings = createMissionControlWorkspaceBindings(
    buildAgentPayloadsFromGatewayList(nativeAgents, [], getOpenClawStateRootPath())
  );
  const manifests = new Map(await Promise.all(bindings.workspacePaths.map(async (path) =>
    [path, await readWorkspaceProjectManifest(path)] as const
  )));
  const workspaces = new Map(bindings.workspacePaths.flatMap((path) => {
    const manifest = manifests.get(path);
    if (manifest?.hidden) return [];
    const workspace = createEmptyWorkspace(path, bindings.resolveWorkspaceId);
    if (manifest?.name) workspace.name = manifest.name;
    return [[path, workspace] as const];
  }));
  for (const rawAgent of bindings.workspaceBoundAgents) {
    const workspace = workspaces.get(rawAgent.workspace);
    if (!workspace) continue;
    const { agent, primaryModel, relationships } = buildSnapshotAgentEntry({
      rawAgent,
      configured: undefined,
      identityOverrides: null,
      workspaceId: workspace.id,
      sessionList: [],
      manifestAgent: manifests.get(rawAgent.workspace)?.agents.find(({ id }) => id === rawAgent.id) ?? null,
      agentRuntimes: [],
      gatewayRpcOk: true,
      profile: { purpose: null, operatingInstructions: [], responseStyle: [], outputPreference: null, sourceFiles: [] }
    });
    workspace.agentIds.push(agent.id);
    if (!workspace.modelIds.includes(primaryModel)) workspace.modelIds.push(primaryModel);
    snapshot.agents.push(agent);
    snapshot.relationships.push(...relationships);
  }
  snapshot.workspaces = Array.from(workspaces.values());
  return snapshot;
}

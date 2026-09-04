import os from "node:os";
import path from "node:path";

import { createDefaultOpenClawBinarySelection } from "@/lib/openclaw/binary-selection";
import {
  createEmptySurfaceDriftSnapshot,
  createEmptySurfaceRuntimeSnapshot
} from "@/lib/openclaw/surface-runtime";
import type { MissionControlSnapshot } from "@/lib/openclaw/types";

function createDefaultConfigUpdatePacingSnapshot(): MissionControlSnapshot["diagnostics"]["configUpdatePacing"] {
  return {
    settings: {
      mode: "respect-gateway",
      minimumIntervalMs: null
    },
    queueDurability: "persistent",
    pending: false,
    pendingCount: 0,
    pendingPaths: [],
    pendingSince: null,
    cooldownUntil: null,
    retryAfterMs: null,
    lastIssue: null,
    lastUpdatedAt: null
  };
}

function createTransientSnapshot(
  reason: string,
  options: {
    installed: boolean;
    loaded: boolean;
    rpcOk: boolean;
    health: MissionControlSnapshot["diagnostics"]["health"];
  }
): MissionControlSnapshot {
  const now = Date.now();
  const workspaceRoot = path.join(os.homedir(), "Documents", "Shared", "projects");
  const stateRoot = path.join(os.homedir(), ".openclaw");

  return {
    generatedAt: new Date(now).toISOString(),
    revision: 0,
    mode: "fallback",
    diagnostics: {
      installed: options.installed,
      loaded: options.loaded,
      rpcOk: options.rpcOk,
      health: options.health,
      workspaceRoot,
      configuredWorkspaceRoot: null,
      dashboardUrl: "http://127.0.0.1:18789/",
      gatewayUrl: "ws://127.0.0.1:18789",
      configuredGatewayUrl: null,
      openClawBinarySelection: createDefaultOpenClawBinarySelection(),
      modelReadiness: {
        ready: false,
        defaultModel: null,
        resolvedDefaultModel: null,
        defaultModelReady: false,
        recommendedModelId: null,
        preferredLoginProvider: null,
        totalModelCount: 0,
        availableModelCount: 0,
        localModelCount: 0,
        remoteModelCount: 0,
        missingModelCount: 0,
        authProviders: [],
        issues: [reason]
      },
      configUpdatePacing: createDefaultConfigUpdatePacingSnapshot(),
      runtime: {
        stateRoot,
        stateWritable: false,
        sessionStoreWritable: false,
        sessionStores: [],
        smokeTest: {
          status: "not-run",
          checkedAt: null,
          agentId: null,
          runId: null,
          summary: null,
          error: null
        },
        issues: [reason]
      },
      runtimeIssues: [],
      securityWarnings: [],
      issues: [reason]
    },
    presence: [],
    channelAccounts: [],
    workspaces: [],
    agents: [],
    models: [],
    runtimes: [],
    tasks: [],
    agentInbox: [],
    nativeWork: {
      availability: {
        worktrees: "unknown",
        suggestions: "unknown",
        ownership: "unknown",
        assignment: "unknown"
      },
      worktrees: [],
      suggestions: [],
      executions: [],
      issues: [reason]
    },
    relationships: [],
    missionPresets: [],
    channelRegistry: {
      version: 1,
      channels: []
    },
    surfaceRuntime: createEmptySurfaceRuntimeSnapshot("unavailable", reason),
    surfaceDrift: createEmptySurfaceDriftSnapshot()
  };
}

export function createLoadingSnapshot(reason: string): MissionControlSnapshot {
  return createTransientSnapshot(reason, {
    installed: true,
    loaded: true,
    rpcOk: false,
    health: "degraded"
  });
}

export function createErrorSnapshot(
  reason: string,
  options: {
    installed: boolean;
    loaded: boolean;
    rpcOk: boolean;
  }
): MissionControlSnapshot {
  return createTransientSnapshot(reason, {
    installed: options.installed,
    loaded: options.loaded,
    rpcOk: options.rpcOk,
    health: options.rpcOk ? "healthy" : options.installed ? "degraded" : "offline"
  });
}

/**
 * Kept for callers that still use the legacy name. Fallback state must never
 * imply that a provider, model, demo agent, or runnable task exists.
 */
export function createFallbackSnapshot(reason: string): MissionControlSnapshot {
  return createErrorSnapshot(reason, {
    installed: false,
    loaded: false,
    rpcOk: false
  });
}

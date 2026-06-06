import assert from "node:assert/strict";
import { test } from "node:test";

import {
  applyAgentPreset,
  buildAgentDraft,
  buildScopedAgentId,
  buildUniqueAgentId,
  isSnapshotModelUsable,
  resolveSuggestedAgentModelId
} from "@/components/mission-control/create-agent-dialog.utils";
import {
  createOptimisticMissionTaskRecord,
  buildLaunchpadWorkspaceHandoffProgress,
  buildWorkspaceSelectionStorageKey,
  mergeSnapshotWithOptimisticTasks,
  resolveGatewayDraft,
  resolveLaunchpadWorkspaceSetupReadiness,
  resolveOpenClawInstallSummary,
  resolveOnboardingAction,
  serializeWorkspaceSelection,
  shouldShowOnboardingLaunchpad,
  resolveWorkspaceSelection,
  shouldDeferWorkspaceSelectionHydration
} from "@/components/mission-control/mission-control-shell.utils";
import { resolveInitialOnboardingModelId } from "@/components/mission-control/openclaw-onboarding.utils";
import { OPENCLAW_RECOMMENDED_VERSION } from "@/lib/openclaw/versions";
import type { MissionControlSnapshot, OperationProgressSnapshot } from "@/lib/agentos/contracts";

test("agent draft helpers keep create flows stable", () => {
  const draft = buildAgentDraft("workspace-1", {
    channelIds: ["alpha", "alpha", "", "beta"]
  });
  const existingAgents = [{ id: "my-workspace-agent-name" }] as unknown as MissionControlSnapshot["agents"];

  assert.equal(draft.workspaceId, "workspace-1");
  assert.deepEqual(draft.channelIds, ["alpha", "beta"]);
  assert.equal(buildScopedAgentId("My Workspace", "Agent Name"), "my-workspace-agent-name");
  assert.equal(buildUniqueAgentId(existingAgents, "My Workspace", "Agent Name"), "my-workspace-agent-name-2");
  assert.equal(applyAgentPreset(draft, "setup").policy.preset, "setup");
});

test("agent draft model helper prefers workspace and available recommended models when default is missing", () => {
  const snapshot = {
    agents: [
      {
        id: "main",
        workspaceId: "workspace",
        modelId: "openai/gpt-5.4-mini"
      }
    ],
    diagnostics: {
      modelReadiness: {
        defaultModelReady: false,
        defaultModel: null,
        resolvedDefaultModel: null,
        recommendedModelId: "openai/gpt-5.5"
      }
    },
    models: [
      {
        id: "openai/gpt-5.4-mini",
        available: true,
        missing: false
      },
      {
        id: "openai/gpt-5.5",
        available: true,
        missing: false
      }
    ]
  } as unknown as MissionControlSnapshot;

  assert.equal(resolveSuggestedAgentModelId(snapshot, "workspace"), "openai/gpt-5.4-mini");
  assert.equal(resolveSuggestedAgentModelId(snapshot, "other-workspace"), "openai/gpt-5.5");
  assert.equal(isSnapshotModelUsable(snapshot, "openai/gpt-5.4-mini"), true);
  assert.equal(isSnapshotModelUsable(snapshot, "openai/missing"), false);
});

test("agent draft model helper skips unavailable workspace models", () => {
  const snapshot = {
    agents: [
      {
        id: "main",
        workspaceId: "workspace",
        modelId: "openai/gpt-5.4-mini"
      }
    ],
    diagnostics: {
      modelReadiness: {
        defaultModelReady: false,
        defaultModel: null,
        resolvedDefaultModel: null,
        recommendedModelId: "openai/gpt-5.5"
      }
    },
    models: [
      {
        id: "openai/gpt-5.4-mini",
        available: false,
        missing: false
      },
      {
        id: "openai/gpt-5.5",
        available: true,
        missing: false
      }
    ]
  } as unknown as MissionControlSnapshot;

  assert.equal(resolveSuggestedAgentModelId(snapshot, "workspace"), "openai/gpt-5.5");
  assert.equal(isSnapshotModelUsable(snapshot, "openai/gpt-5.4-mini"), false);
});

test("control plane helpers normalize snapshot and onboarding fallback", () => {
  const gatewaySnapshot = {
    diagnostics: { configuredGatewayUrl: "ws://127.0.0.1:18789/" }
  } as unknown as MissionControlSnapshot;
  const onboardingSnapshot = {
    diagnostics: { installed: false, rpcOk: false, loaded: false }
  } as unknown as MissionControlSnapshot;
  const emptySnapshot = {
    agents: [],
    diagnostics: {},
    runtimes: [],
    tasks: []
  } as unknown as MissionControlSnapshot;

  assert.equal(resolveGatewayDraft(gatewaySnapshot), "ws://127.0.0.1:18789");
  assert.equal(resolveOnboardingAction(onboardingSnapshot).label, "Install OpenClaw");
  assert.match(resolveOnboardingAction(onboardingSnapshot).description, new RegExp(OPENCLAW_RECOMMENDED_VERSION));

  const onlineWithoutWorkspace = {
    workspaces: [],
    agents: [],
    diagnostics: {
      installed: true,
      rpcOk: true,
      runtime: {
        stateWritable: true,
        sessionStoreWritable: true
      }
    }
  } as unknown as MissionControlSnapshot;

  assert.equal(resolveOnboardingAction(onlineWithoutWorkspace).label, "Continue setup");

  const optimisticTask = createOptimisticMissionTaskRecord(
    {
      requestId: "req-1",
      mission: "Ship the change",
      agentId: "agent-1",
      workspaceId: "workspace-1",
      submittedAt: 1_700_000_000_000,
      abortController: new AbortController()
    },
    emptySnapshot
  );

  const merged = mergeSnapshotWithOptimisticTasks(
    emptySnapshot,
    [{ requestId: "req-1", dispatchId: null, task: optimisticTask.task }]
  );

  assert.equal(merged.tasks.length, 1);
  assert.equal(merged.tasks[0].key, "optimistic:req-1");
});

test("install summary reflects the active install family and root", () => {
  const localPrefixSnapshot = {
    diagnostics: {
      updateRoot: "/Users/kazimakgul/.openclaw/lib/node_modules/openclaw",
      updateInstallKind: "package",
      updatePackageManager: "npm"
    }
  } as unknown as MissionControlSnapshot;
  const gitSnapshot = {
    diagnostics: {
      updateRoot: "/Users/kazimakgul/openclaw",
      updateInstallKind: "git",
      updatePackageManager: "pnpm"
    }
  } as unknown as MissionControlSnapshot;

  assert.equal(resolveOpenClawInstallSummary(localPrefixSnapshot).label, "Local prefix · npm");
  assert.equal(
    resolveOpenClawInstallSummary(localPrefixSnapshot).detail,
    "Install root: ~/.openclaw/lib/node_modules/openclaw · Updater: npm"
  );
  assert.equal(resolveOpenClawInstallSummary(gitSnapshot).label, "Git checkout");
  assert.equal(
    resolveOpenClawInstallSummary(gitSnapshot).detail,
    "Install root: ~/openclaw · Updater: pnpm"
  );
});

test("initial onboarding model uses a ready default without forcing discovery", () => {
  const blankSnapshot = {
    workspaces: [],
    diagnostics: {
      modelReadiness: {
        resolvedDefaultModel: null,
        defaultModel: null,
        recommendedModelId: "openai-codex/gpt-5.4",
        authProviders: [
          {
            provider: "openai-codex",
            connected: false,
            canLogin: true
          }
        ]
      }
    }
  } as unknown as MissionControlSnapshot;
  const staleDefaultSnapshot = {
    workspaces: [],
    diagnostics: {
      modelReadiness: {
        resolvedDefaultModel: "openai-codex/gpt-5.4",
        defaultModel: "openai-codex/gpt-5.4",
        defaultModelReady: false,
        recommendedModelId: "openai-codex/gpt-5.4",
        authProviders: [
          {
            provider: "openai-codex",
            connected: false,
            canLogin: true
          }
        ]
      }
    }
  } as unknown as MissionControlSnapshot;
  const connectedSnapshot = {
    workspaces: [],
    diagnostics: {
      modelReadiness: {
        resolvedDefaultModel: null,
        defaultModel: null,
        recommendedModelId: "openai-codex/gpt-5.4",
        authProviders: [
          {
            provider: "openai-codex",
            connected: true,
            canLogin: true
          }
        ]
      }
    }
  } as unknown as MissionControlSnapshot;
  const readyDefaultSnapshot = {
    workspaces: [],
    diagnostics: {
      modelReadiness: {
        resolvedDefaultModel: "openai-codex/gpt-5.4",
        defaultModel: "openai-codex/gpt-5.4",
        defaultModelReady: true,
        recommendedModelId: "openai-codex/gpt-5.4",
        authProviders: [
          {
            provider: "openai-codex",
            connected: true,
            canLogin: true
          }
        ]
      }
    }
  } as unknown as MissionControlSnapshot;
  const workspaceSnapshot = {
    workspaces: [
      {
        id: "workspace-1"
      }
    ],
    diagnostics: {
      modelReadiness: {
        resolvedDefaultModel: "openai-codex/gpt-5.4",
        defaultModel: "openai-codex/gpt-5.4",
        defaultModelReady: true,
        recommendedModelId: "openai-codex/gpt-5.4",
        authProviders: [
          {
            provider: "openai-codex",
            connected: true,
            canLogin: true
          }
        ]
      }
    }
  } as unknown as MissionControlSnapshot;

  assert.equal(resolveInitialOnboardingModelId(blankSnapshot), null);
  assert.equal(resolveInitialOnboardingModelId(staleDefaultSnapshot), null);
  assert.equal(resolveInitialOnboardingModelId(connectedSnapshot), null);
  assert.equal(resolveInitialOnboardingModelId(readyDefaultSnapshot), "openai-codex/gpt-5.4");
  assert.equal(resolveInitialOnboardingModelId(workspaceSnapshot), "openai-codex/gpt-5.4");
});

test("onboarding launchpad requires confirmed setup or a workspace-backed model", () => {
  const detectedDefaultOnly = {
    workspaces: [],
    agents: [],
    models: [],
    diagnostics: {
      installed: true,
      rpcOk: true,
      runtime: {
        stateWritable: true,
        sessionStoreWritable: true
      },
      modelReadiness: {
        ready: false,
        resolvedDefaultModel: "openai/gpt-5.4",
        defaultModel: "openai/gpt-5.4"
      }
    }
  } as unknown as MissionControlSnapshot;
  const workspaceBackedDefault = {
    ...detectedDefaultOnly,
    workspaces: [
      {
        id: "workspace-1"
      }
    ],
    agents: [
      {
        id: "agent-1"
      }
    ]
  } as unknown as MissionControlSnapshot;
  const workspaceBackedAgentModel = {
    ...detectedDefaultOnly,
    workspaces: [
      {
        id: "workspace-1"
      }
    ],
    agents: [
      {
        id: "agent-1",
        workspaceId: "workspace-1",
        modelId: "openai/gpt-5.4-mini"
      }
    ],
    models: [
      {
        id: "openai/gpt-5.4-mini",
        available: true,
        missing: false
      }
    ],
    diagnostics: {
      ...detectedDefaultOnly.diagnostics,
      modelReadiness: {
        ...detectedDefaultOnly.diagnostics.modelReadiness,
        resolvedDefaultModel: null,
        defaultModel: null
      }
    }
  } as unknown as MissionControlSnapshot;
  const workspaceWithoutAgent = {
    ...detectedDefaultOnly,
    workspaces: [
      {
        id: "workspace-1"
      }
    ],
    agents: []
  } as unknown as MissionControlSnapshot;
  const readyModel = {
    ...detectedDefaultOnly,
    diagnostics: {
      ...detectedDefaultOnly.diagnostics,
      modelReadiness: {
        ...detectedDefaultOnly.diagnostics.modelReadiness,
        ready: true
      }
    }
  } as unknown as MissionControlSnapshot;

  assert.equal(shouldShowOnboardingLaunchpad(detectedDefaultOnly), false);
  assert.equal(shouldShowOnboardingLaunchpad(workspaceWithoutAgent), false);
  assert.equal(shouldShowOnboardingLaunchpad(workspaceBackedDefault), true);
  assert.equal(shouldShowOnboardingLaunchpad(workspaceBackedAgentModel), true);
  assert.equal(shouldShowOnboardingLaunchpad(readyModel), false);
  assert.equal(
    shouldShowOnboardingLaunchpad(readyModel, {
      hasSeenMissionReady: true
    }),
    true
  );
  assert.equal(
    shouldShowOnboardingLaunchpad(detectedDefaultOnly, {
      modelSwitchSucceeded: true
    }),
    true
  );
});

test("launchpad workspace handoff waits for the workspace and starter agent", () => {
  const target = {
    workspaceId: "workspace-1",
    workspacePath: "/tmp/workspace-1",
    agentIds: ["agent-1"],
    primaryAgentId: "agent-1"
  };
  const workspaceShellSnapshot = {
    workspaces: [
      {
        id: "workspace-1",
        name: "Workspace 1",
        path: "/tmp/workspace-1",
        agentIds: ["agent-1"]
      }
    ],
    agents: []
  } as unknown as MissionControlSnapshot;
  const readySnapshot = {
    ...workspaceShellSnapshot,
    agents: [
      {
        id: "agent-1",
        workspaceId: "workspace-1"
      }
    ]
  } as unknown as MissionControlSnapshot;

  const shellReadiness = resolveLaunchpadWorkspaceSetupReadiness(workspaceShellSnapshot, target);
  const readyReadiness = resolveLaunchpadWorkspaceSetupReadiness(readySnapshot, target);

  assert.equal(shellReadiness.workspaceVisible, true);
  assert.equal(shellReadiness.primaryAgentVisible, false);
  assert.equal(shellReadiness.ready, false);
  assert.equal(readyReadiness.ready, true);

  const baseProgress: OperationProgressSnapshot = {
    title: "Provisioning workspace",
    description: "Creating workspace.",
    percent: 100,
    steps: [
      {
        id: "validate",
        label: "Checking input",
        description: "Checking input and target path.",
        status: "done",
        percent: 100,
        activities: []
      }
    ]
  };
  const syncingProgress = buildLaunchpadWorkspaceHandoffProgress({
    progress: baseProgress,
    readiness: shellReadiness,
    state: "syncing"
  });
  const syncingHandoffStep = syncingProgress.steps[syncingProgress.steps.length - 1];

  assert.equal(syncingProgress.title, "Opening workspace");
  assert.equal(syncingHandoffStep.id, "canvas-handoff");
  assert.equal(syncingHandoffStep.status, "active");
  assert.match(syncingHandoffStep.detail ?? "", /starter agent/);

  const readyProgress = buildLaunchpadWorkspaceHandoffProgress({
    progress: syncingProgress,
    readiness: readyReadiness,
    state: "ready"
  });
  const readyHandoffStep = readyProgress.steps[readyProgress.steps.length - 1];

  assert.equal(readyProgress.percent, 100);
  assert.equal(readyHandoffStep.status, "done");
});

test("workspace selection helpers keep the last valid workspace", () => {
  assert.equal(
    buildWorkspaceSelectionStorageKey("/tmp/workspaces"),
    "mission-control-active-workspace-id:/tmp/workspaces"
  );
  assert.equal(serializeWorkspaceSelection(null), "__all__");
  assert.equal(resolveWorkspaceSelection(["workspace-a", "workspace-b"], "workspace-b"), "workspace-b");
  assert.equal(resolveWorkspaceSelection(["workspace-a", "workspace-b"], "workspace-missing"), "workspace-a");
  assert.equal(
    resolveWorkspaceSelection(["workspace-a", "workspace-b"], null, "workspace-b"),
    "workspace-b"
  );
  assert.equal(resolveWorkspaceSelection(["workspace-a", "workspace-b"], "__all__"), null);
  assert.equal(resolveWorkspaceSelection([], "workspace-missing"), null);
});

test("workspace selection hydration waits for real snapshots", () => {
  const loadingSnapshot = {
    mode: "fallback",
    diagnostics: {
      loaded: true,
      rpcOk: false
    }
  } as unknown as MissionControlSnapshot;
  const fallbackSnapshot = {
    mode: "fallback",
    diagnostics: {
      loaded: false,
      rpcOk: false
    }
  } as unknown as MissionControlSnapshot;
  const liveSnapshot = {
    mode: "live",
    diagnostics: {
      loaded: true,
      rpcOk: true
    }
  } as unknown as MissionControlSnapshot;

  assert.equal(shouldDeferWorkspaceSelectionHydration(loadingSnapshot), true);
  assert.equal(shouldDeferWorkspaceSelectionHydration(fallbackSnapshot), false);
  assert.equal(shouldDeferWorkspaceSelectionHydration(liveSnapshot), false);
});

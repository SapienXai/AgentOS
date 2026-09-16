import "server-only";

import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstat, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { clearMissionControlCaches, deleteAgent, deleteWorkspaceProject, getMissionControlSnapshot } from "@/lib/agentos/control-plane";
import { listAgentOsRuntimeCleanupPaths, removeAgentOsRuntimeState } from "@/lib/agentos/runtime-cleanup";
import { WORKSPACE_PROVISIONING_MANIFEST_RELATIVE_PATH } from "@/lib/agentos/application/workspace-provisioning-store";
import { resetOpenClawBinCache, runOpenClaw, formatOpenClawCommand } from "@/lib/openclaw/cli";
import { stringifyCommandFailure } from "@/lib/openclaw/command-failure";
import { resolveOpenClawConfigPath, resolveOpenClawStateDir } from "@/lib/openclaw/client/gateway-state";
import {
  readWorkspaceFilesystemOwnership,
  resolveWorkspaceFilesystemOwnership,
  isAgentOsOwnedWorkspaceFilesystem,
  type WorkspaceFilesystemOwnershipRecord
} from "@/lib/openclaw/domains/workspace-filesystem-ownership";
import { missionControlRootPath } from "@/lib/openclaw/state/paths";
import { resolveAgentOsRuntimeDir } from "@/lib/agentos/runtime-auth";
import { redactSecretText } from "@/lib/security/redaction";
import type {
  MissionControlSnapshot,
  ResetFailureClass,
  ResetNativeOpenClawPlan,
  ResetOperationStatus,
  ResetPreview,
  ResetPreviewPackageAction,
  ResetPreviewWorkspace,
  ResetStreamEvent,
  ResetTarget
} from "@/lib/agentos/contracts";

const execFileAsync = promisify(execFile);

const missionControlSettingsPath = path.join(missionControlRootPath, "settings.json");
const plannerRootPath = path.join(missionControlRootPath, "planner");
const missionDispatchesRootPath = path.join(missionControlRootPath, "dispatches");
const channelRegistryPath = path.join(missionControlRootPath, "channel-registry.json");
const telegramRouterRootPath = path.join(missionControlRootPath, "telegram-router");
const workspaceOwnershipRootPath = path.join(missionControlRootPath, "workspace-filesystem-ownership");
const plannerRuntimeWorkspacePath = path.join(plannerRootPath, "runtime-workspace");
const browserStorageKeys = [
  "mission-control-surface-theme",
  "mission-control-hidden-runtime-ids",
  "mission-control-hidden-task-keys",
  "mission-control-locked-task-keys",
  "mission-control-workspace-plan-id",
  "mission-control-recent-prompts",
  "mission-control-node-positions",
  "mission-control-node-positions:v2:*",
  "mission-control-active-workspace-id:*",
  "mission-control-composer-draft:*",
  "mission-control-agent-chat:v1:*",
  "mission-control-agent-chat-seen:v1:"
] as const;
const liveAgentStatuses = new Set(["engaged", "monitoring", "ready"]);
const supportedPackageManagers = new Set(["pnpm", "npm", "yarn"]);
const openClawNativeUninstallArgs = [
  "uninstall",
  "--service",
  "--state",
  "--yes",
  "--non-interactive"
] as const;
const nativeOpenClawTimeoutMs = 45_000;
const nativeOpenClawPreflightTimeoutMs = 15_000;

type ResetEventEmitter = (event: ResetStreamEvent) => Promise<void>;

export type ResetExecutionDependencies = {
  getMissionControlSnapshot?: typeof getMissionControlSnapshot;
  runOpenClaw?: typeof runOpenClaw;
  clearMissionControlCaches?: typeof clearMissionControlCaches;
  resetOpenClawBinCache?: typeof resetOpenClawBinCache;
  removeAgentOsRuntimeState?: typeof removeAgentOsRuntimeState;
  runAgentOsCleanup?: (preview: ResetPreview, emit: ResetEventEmitter, env: NodeJS.ProcessEnv) => Promise<void>;
  detectPackageActions?: typeof detectPackageActions;
  schedulePackageRemoval?: typeof scheduleBackgroundPackageRemoval;
};

export type ResetPreviewOptions = {
  dependencies?: ResetExecutionDependencies;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
};

export type ResetExecutionOptions = ResetPreviewOptions & {
  onEvent?: (event: ResetStreamEvent) => Promise<void> | void;
  preview?: ResetPreview;
};

export type ResetExecutionResult = {
  ok: boolean;
  status: ResetOperationStatus;
  message: string;
  failureClass?: ResetFailureClass;
  snapshot?: MissionControlSnapshot;
  backgroundLogPath?: string;
};

class ResetOperationFailure extends Error {
  constructor(
    message: string,
    readonly failureClass: ResetFailureClass
  ) {
    super(message);
    this.name = "ResetOperationFailure";
  }
}

export async function getResetPreview(
  target: ResetTarget,
  options: ResetPreviewOptions = {}
): Promise<ResetPreview> {
  const env = options.env ?? process.env;
  const dependencies = options.dependencies ?? {};
  const snapshot = await (dependencies.getMissionControlSnapshot ?? getMissionControlSnapshot)({
    force: true,
    includeHidden: true
  });
  const workspaces = await buildResetPreviewWorkspaces(snapshot, target, env);
  const workspaceIds = new Set(workspaces.map((workspace) => workspace.workspaceId));
  const packageActions = target === "full-uninstall"
    ? await (dependencies.detectPackageActions ?? detectPackageActions)(snapshot, env)
    : [];
  const nativeOpenClaw = target === "full-uninstall"
    ? await buildNativeOpenClawPlan(dependencies.runOpenClaw ?? runOpenClaw, env)
    : null;
  const summary = {
    deleteFolderCount: workspaces.filter((workspace) => workspace.action === "delete-folder").length,
    metadataOnlyCount: workspaces.filter((workspace) => workspace.action === "clean-integration").length,
    agentCount: workspaces.reduce((total, workspace) => total + workspace.agentCount, 0),
    liveAgentCount: workspaces.reduce((total, workspace) => total + workspace.liveAgentCount, 0),
    activeRuntimeCount: snapshot.runtimes.filter((runtime) => {
      return (
        typeof runtime.workspaceId === "string" &&
        workspaceIds.has(runtime.workspaceId) &&
        (runtime.status === "running" || runtime.status === "queued")
      );
    }).length
  };
  const warnings = buildResetWarnings(target, workspaces, summary, packageActions, nativeOpenClaw);

  return {
    target,
    generatedAt: (options.now ?? (() => new Date()))().toISOString(),
    summary,
    workspaces,
    missionControlPaths: resolveMissionControlResetPaths(target),
    agentOsRuntimePaths: target === "full-uninstall" ? listAgentOsRuntimeCleanupPaths(env) : [],
    browserStorageKeys: [...browserStorageKeys],
    openClawPaths: target === "full-uninstall" ? resolveOpenClawCleanupPaths(env) : [],
    nativeOpenClaw,
    packageActions,
    warnings
  };
}

export async function executeReset(
  target: ResetTarget,
  options: ResetExecutionOptions = {}
): Promise<ResetExecutionResult> {
  const env = options.env ?? process.env;
  const dependencies = options.dependencies ?? {};
  const preview = options.preview ?? await getResetPreview(target, options);
  const emit: ResetEventEmitter = async (event) => {
    await options.onEvent?.(event);
  };

  await emit({
    type: "status",
    phase: "planning",
    message: target === "mission-control"
      ? "Preparing the AgentOS reset plan..."
      : "Preparing the full uninstall plan..."
  });
  await emit({
    type: "log",
    text: `Found ${preview.workspaces.length} workspace(s), ${preview.summary.agentCount} agent(s), and ${preview.summary.liveAgentCount} live agent(s).`
  });

  if (target === "full-uninstall") {
    const nativeResult = await runOpenClawNativeTeardown(
      preview.nativeOpenClaw,
      dependencies.runOpenClaw ?? runOpenClaw,
      emit
    );

    if (!nativeResult.ok) {
      const detail = nativeResult.detail ? ` ${nativeResult.detail}` : "";
      return finishResetFailure({
        target,
        status: "failed",
        failureClass: nativeResult.failureClass,
        message: `Full uninstall stopped because OpenClaw native teardown could not be completed. AgentOS did not mutate OpenClaw state; retry after recovery.${detail}`,
        emit
      });
    }
  }

  try {
    await (dependencies.runAgentOsCleanup ?? runAgentOsCleanup)(preview, emit, env);
  } catch (error) {
    return finishResetFailure({
      target,
      status: "partial",
      failureClass: error instanceof ResetOperationFailure ? error.failureClass : "partial",
      message: `${target === "full-uninstall" ? "OpenClaw teardown completed, but" : "AgentOS reset stopped because"} AgentOS cleanup is incomplete. ${safeErrorDetail(error)}`,
      emit
    });
  }

  let operationStatus: ResetOperationStatus = "succeeded";
  let failureClass: ResetFailureClass | undefined;
  let backgroundLogPath: string | undefined;

  if (target === "full-uninstall") {
    try {
      await (dependencies.removeAgentOsRuntimeState ?? removeAgentOsRuntimeState)(env);
      await emit({
        type: "log",
        text: "Removed the allowlisted AgentOS runtime state while preserving unknown runtime files."
      });
    } catch (error) {
      return finishResetFailure({
        target,
        status: "partial",
        failureClass: error instanceof ResetOperationFailure ? error.failureClass : "partial",
        message: `OpenClaw teardown and AgentOS workspace cleanup completed, but AgentOS runtime cleanup is incomplete. ${safeErrorDetail(error)}`,
        emit
      });
    }

    await emit({
      type: "status",
      phase: "package-removal",
      message: "Preparing package cleanup for the detected installation modes..."
    });

    const detectedActions = preview.packageActions.filter((action) => action.detected && action.executable && action.args);
    const manualActions = preview.packageActions.filter((action) => action.required && !action.detected);

    if (detectedActions.length > 0) {
      try {
        backgroundLogPath = await (dependencies.schedulePackageRemoval ?? scheduleBackgroundPackageRemoval)(detectedActions);
        await emit({
          type: "log",
          text: `Package removal scheduled after AgentOS exits. Log: ${backgroundLogPath}`
        });
        operationStatus = "scheduled";
      } catch (error) {
        operationStatus = "partial";
        failureClass = "partial";
        await emit({
          type: "log",
          text: `Package removal could not be scheduled: ${safeErrorDetail(error)}`
        });
      }
    }

    if (manualActions.length > 0) {
      operationStatus = "partial";
      failureClass = "partial";
      await emit({
        type: "log",
        text: `Manual package cleanup remains for: ${manualActions.map((action) => action.packageName).join(", ")}.`
      });
    }
  }

  await emit({
    type: "status",
    phase: "refreshing",
    message: "Refreshing the AgentOS snapshot..."
  });

  try {
    if (target === "full-uninstall") {
      (dependencies.resetOpenClawBinCache ?? resetOpenClawBinCache)();
    }
    (dependencies.clearMissionControlCaches ?? clearMissionControlCaches)();
  } catch (error) {
    operationStatus = "partial";
    failureClass = "partial";
    await emit({
      type: "log",
      text: `Runtime cache refresh could not be completed: ${safeErrorDetail(error)}`
    });
  }

  let snapshot: MissionControlSnapshot | undefined;
  try {
    snapshot = await (dependencies.getMissionControlSnapshot ?? getMissionControlSnapshot)({
      force: true,
      loadProfile: target === "full-uninstall" ? "system" : "interactive"
    });
  } catch (error) {
    operationStatus = "partial";
    failureClass = "partial";
    await emit({
      type: "log",
      text: `Snapshot refresh could not be completed: ${safeErrorDetail(error)}`
    });
  }

  const message = operationStatus === "partial"
    ? "The reset completed only partially. Review the cleanup log and recovery guidance."
    : target === "mission-control"
      ? "AgentOS reset completed."
      : operationStatus === "scheduled"
        ? "Uninstall finishing. Native OpenClaw and AgentOS state cleanup completed; package removal is scheduled after AgentOS exits."
        : "Full uninstall completed for AgentOS and OpenClaw state.";

  await emit({
    type: "log",
    text: message
  });

  return {
    ok: operationStatus !== "partial",
    status: operationStatus,
    ...(failureClass ? { failureClass } : {}),
    message,
    snapshot,
    ...(backgroundLogPath ? { backgroundLogPath } : {})
  };
}

export async function buildResetPreviewWorkspaces(
  snapshot: MissionControlSnapshot,
  target: ResetTarget,
  env: NodeJS.ProcessEnv = process.env
): Promise<ResetPreviewWorkspace[]> {
  const openClawStateRootPath = resolveOpenClawStateDir(env);
  const agentsByWorkspace = new Map<string, MissionControlSnapshot["agents"]>();
  const runtimesByWorkspace = new Map<string, MissionControlSnapshot["runtimes"]>();

  for (const workspace of snapshot.workspaces) {
    agentsByWorkspace.set(workspace.id, snapshot.agents.filter((agent) => agent.workspaceId === workspace.id));
    runtimesByWorkspace.set(workspace.id, snapshot.runtimes.filter((runtime) => runtime.workspaceId === workspace.id));
  }

  const planned = await Promise.all(snapshot.workspaces.map(async (workspace) => {
    if (isOpenClawStateWorkspacePath(workspace.path, openClawStateRootPath)) {
      return null;
    }

    const agents = agentsByWorkspace.get(workspace.id) ?? [];
    const runtimes = runtimesByWorkspace.get(workspace.id) ?? [];
    const ownershipRecord = await readWorkspaceFilesystemOwnership(workspace.path);
    const classification = classifyResetWorkspaceOwnership({
      workspacePath: workspace.path,
      sourceMode: workspace.bootstrap.sourceMode,
      ownershipRecord,
      plannerRuntimeWorkspacePath,
      openClawStateRootPath
    });
    const integrationPaths = await findExplicitIntegrationPaths(workspace.path);

    return {
      workspaceId: workspace.id,
      name: workspace.name,
      path: workspace.path,
      sourceMode: workspace.bootstrap.sourceMode,
      ownership: classification.ownership,
      action: classification.action,
      integrationPaths,
      agentCount: agents.length,
      runtimeCount: runtimes.length,
      liveAgentCount: agents.filter((agent) => liveAgentStatuses.has(agent.status)).length,
      reasons: [
        ...classification.reasons,
        ...(integrationPaths.length > 0
          ? [`Only this explicit AgentOS integration marker is eligible for file-level cleanup: ${integrationPaths.join(", ")}.`]
          : ["No explicit AgentOS integration marker was found in this folder."])
      ]
    } satisfies ResetPreviewWorkspace;
  }));

  return planned
    .filter((workspace): workspace is ResetPreviewWorkspace => Boolean(workspace))
    .sort((left, right) => {
      if (left.action !== right.action) return left.action === "delete-folder" ? -1 : 1;
      return left.name.localeCompare(right.name);
    });
}

export function classifyResetWorkspaceOwnership(input: {
  workspacePath: string;
  sourceMode: "empty" | "clone" | "existing" | null;
  ownershipRecord?: WorkspaceFilesystemOwnershipRecord | null;
  plannerRuntimeWorkspacePath?: string;
  openClawStateRootPath?: string;
}) {
  const workspacePath = path.resolve(input.workspacePath);
  const openClawStateRootPath = path.resolve(input.openClawStateRootPath ?? resolveOpenClawStateDir());
  const plannerPath = path.resolve(input.plannerRuntimeWorkspacePath ?? plannerRuntimeWorkspacePath);

  if (isOpenClawStateWorkspacePath(workspacePath, openClawStateRootPath)) {
    return {
      ownership: "OPENCLAW_OWNED" as const,
      action: "clean-integration" as const,
      reasons: ["This path is inside OpenClaw state and is handled by OpenClaw's native lifecycle."]
    };
  }

  if (workspacePath === plannerPath || isPathWithin(plannerPath, workspacePath)) {
    return {
      ownership: "AGENTOS_OWNED" as const,
      action: "delete-folder" as const,
      reasons: ["Planner runtime workspace is explicitly managed by AgentOS."]
    };
  }

  const recordedOwnership = resolveWorkspaceFilesystemOwnership(input.ownershipRecord);
  if (isAgentOsOwnedWorkspaceFilesystem(recordedOwnership)) {
    return {
      ownership: "AGENTOS_OWNED" as const,
      action: "delete-folder" as const,
      reasons: ["Durable AgentOS filesystem ownership proof identifies this as an AgentOS-created workspace."]
    };
  }

  if (recordedOwnership === "user-selected-existing" || recordedOwnership === "external-imported") {
    return {
      ownership: "USER_OWNED" as const,
      action: "clean-integration" as const,
      reasons: ["Durable ownership proof identifies this as an existing or imported user folder; the folder will be preserved."]
    };
  }

  return {
    ownership: "UNKNOWN" as const,
    action: "clean-integration" as const,
    reasons: [
      input.sourceMode
        ? `Workspace source metadata is ${input.sourceMode}, but no durable filesystem ownership proof was found.`
        : "Workspace origin is unknown and no durable filesystem ownership proof was found.",
      "The folder will be preserved; OpenClaw-owned data is not recursively removed."
    ]
  };
}

function buildResetWarnings(
  target: ResetTarget,
  workspaces: ResetPreviewWorkspace[],
  summary: ResetPreview["summary"],
  packageActions: ResetPreviewPackageAction[],
  nativeOpenClaw: ResetNativeOpenClawPlan | null
) {
  const warnings: string[] = [];

  if (summary.liveAgentCount > 0) {
    warnings.push(`${summary.liveAgentCount} live agent${summary.liveAgentCount === 1 ? "" : "s"} may be interrupted immediately.`);
  }
  if (summary.activeRuntimeCount > 0) {
    warnings.push(`${summary.activeRuntimeCount} active or queued runtime${summary.activeRuntimeCount === 1 ? "" : "s"} may stop mid-run.`);
  }

  const metadataOnlyWorkspaces = workspaces.filter((workspace) => workspace.action === "clean-integration").length;
  if (metadataOnlyWorkspaces > 0) {
    warnings.push(`${metadataOnlyWorkspaces} folder${metadataOnlyWorkspaces === 1 ? "" : "s"} will be preserved. Only explicitly listed AgentOS integration markers may be removed there.`);
  }

  if (target === "full-uninstall" && nativeOpenClaw?.status === "blocked") {
    warnings.push(`Native OpenClaw teardown is blocked. No OpenClaw state or workspace cleanup will run until this is resolved. ${nativeOpenClaw.reason ?? "Retry after repairing the OpenClaw CLI or service."}`);
  } else if (target === "full-uninstall" && nativeOpenClaw?.preservesConfiguredWorkspaces) {
    warnings.push("OpenClaw native teardown is planned with service and state scopes; configured workspace folders are preserved for AgentOS ownership checks.");
  }

  if (target === "full-uninstall" && packageActions.some((action) => action.required && !action.detected)) {
    warnings.push("Some detected installation modes require manual package cleanup because a safe supported command was not available.");
  }

  return warnings;
}

async function runAgentOsCleanup(preview: ResetPreview, emit: ResetEventEmitter, env: NodeJS.ProcessEnv) {
  await emit({
    type: "status",
    phase: "agentos-workspaces",
    message: preview.workspaces.length > 0
      ? "Applying the ownership-scoped AgentOS workspace cleanup plan..."
      : "No AgentOS workspace cleanup is required."
  });

  const fullUninstall = preview.target === "full-uninstall";
  for (const workspace of preview.workspaces) {
    if (workspace.action === "delete-folder") {
      if (!fullUninstall) {
        const result = await deleteWorkspaceProject({ workspaceId: workspace.workspaceId });
        if (result.outcome !== "ready" || result.nativeConfirmed !== true) {
          throw new ResetOperationFailure(
            `OpenClaw did not confirm deletion of managed workspace ${workspace.name}. The folder was preserved.`,
            "partial"
          );
        }
      }

      await removeManagedWorkspaceFolder(workspace, emit, env);
      continue;
    }

    if (!fullUninstall) {
      const snapshot = await getMissionControlSnapshot({ force: true, includeHidden: true });
      const agents = snapshot.agents.filter((agent) => agent.workspaceId === workspace.workspaceId);
      for (const agent of agents) {
        try {
          await emit({ type: "log", text: `Deleting AgentOS-managed agent ${agent.id} from ${workspace.name}.` });
          const result = await deleteAgent({ agentId: agent.id });
          if (result.outcome && result.outcome !== "ready") {
            throw new ResetOperationFailure(
              `OpenClaw did not confirm deletion of agent ${agent.id}.`,
              "partial"
            );
          }
        } catch (error) {
          if (isProtectedAgentDeleteError(error)) {
            await emit({ type: "log", text: `Preserved protected agent ${agent.id} in ${workspace.name}.` });
            continue;
          }
          throw error;
        }
      }
    }

    await removeWorkspaceIntegrationArtifacts(workspace, emit);
  }

  await emit({
    type: "status",
    phase: "agentos-state",
    message: fullUninstall
      ? "Removing AgentOS Mission Control state and ownership records..."
      : "Removing AgentOS planner, dispatch, and settings state..."
  });
  await removeMissionControlState(preview.target, emit);
}

async function removeManagedWorkspaceFolder(
  workspace: ResetPreviewWorkspace,
  emit: ResetEventEmitter,
  env: NodeJS.ProcessEnv
) {
  const workspacePath = path.resolve(workspace.path);
  let directoryStat;
  try {
    directoryStat = await lstat(workspacePath);
  } catch (error) {
    if (isNodeError(error, "ENOENT")) {
      await emit({ type: "log", text: `Managed workspace folder is already absent: ${workspace.path}` });
      return;
    }
    throw error;
  }

  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    throw new ResetOperationFailure(
      `Refusing to remove ${workspace.path}: the managed workspace is not a regular directory.`,
      "ownership-safety-failed"
    );
  }

  const ownershipRecord = await readWorkspaceFilesystemOwnership(workspacePath);
  const ownership = resolveWorkspaceFilesystemOwnership(ownershipRecord);
  const plannerOwned = workspacePath === plannerRuntimeWorkspacePath || isPathWithin(plannerRuntimeWorkspacePath, workspacePath);
  if (!plannerOwned && !isAgentOsOwnedWorkspaceFilesystem(ownership)) {
    throw new ResetOperationFailure(
      `Refusing to remove ${workspace.path}: current durable ownership evidence is not AgentOS-owned.`,
      "ownership-safety-failed"
    );
  }

  assertSafeManagedWorkspaceDeletionTarget(workspacePath, env);
  await rm(workspacePath, { recursive: true, force: true });
  await emit({ type: "log", text: `Removed AgentOS-owned workspace folder: ${workspace.path}` });
}

function assertSafeManagedWorkspaceDeletionTarget(workspacePath: string, env: NodeJS.ProcessEnv) {
  const resolvedPath = path.resolve(workspacePath);
  const rootPath = path.parse(resolvedPath).root;
  const stateRoot = resolveOpenClawStateDir(env);
  const runtimeRoot = resolveAgentOsRuntimeDir(env);
  const protectedRoots = [
    os.homedir(),
    process.cwd(),
    missionControlRootPath,
    stateRoot,
    runtimeRoot
  ].map((entry) => path.resolve(entry));

  if (resolvedPath === rootPath || protectedRoots.some((protectedRoot) => {
    return resolvedPath === protectedRoot || isPathWithin(resolvedPath, protectedRoot);
  })) {
    throw new ResetOperationFailure(
      `Refusing to remove ${resolvedPath}: it overlaps a protected AgentOS, OpenClaw, runtime, home, or process directory.`,
      "ownership-safety-failed"
    );
  }

  if (isPathWithin(stateRoot, resolvedPath) || isPathWithin(runtimeRoot, resolvedPath)) {
    throw new ResetOperationFailure(
      `Refusing to remove ${resolvedPath}: it is inside an OpenClaw or AgentOS runtime root.`,
      "ownership-safety-failed"
    );
  }
}

export async function removeWorkspaceIntegrationArtifacts(workspace: ResetPreviewWorkspace, emit: ResetEventEmitter) {
  const markerPath = path.resolve(workspace.path, WORKSPACE_PROVISIONING_MANIFEST_RELATIVE_PATH);
  if (!workspace.integrationPaths.includes(markerPath)) {
    await emit({ type: "log", text: `No explicit AgentOS integration marker found for ${workspace.name}; preserved the folder.` });
    return;
  }

  let markerStat;
  try {
    markerStat = await lstat(markerPath);
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return;
    throw error;
  }

  if (!markerStat.isFile() || markerStat.isSymbolicLink()) {
    throw new ResetOperationFailure(
      `Refusing to remove ${markerPath}: the AgentOS integration marker is not a regular file.`,
      "ownership-safety-failed"
    );
  }

  await rm(markerPath, { force: true });
  await emit({ type: "log", text: `Removed explicit AgentOS integration marker: ${markerPath}` });
}

async function findExplicitIntegrationPaths(workspacePath: string) {
  const markerPath = path.resolve(workspacePath, WORKSPACE_PROVISIONING_MANIFEST_RELATIVE_PATH);
  try {
    const markerStat = await lstat(markerPath);
    return markerStat.isFile() && !markerStat.isSymbolicLink() ? [markerPath] : [];
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return [];
    throw error;
  }
}

async function removeMissionControlState(target: ResetTarget, emit: ResetEventEmitter) {
  const paths = resolveMissionControlResetPaths(target);
  for (const targetPath of paths) {
    await rm(targetPath, { recursive: true, force: true });
  }
  if (target !== "full-uninstall") {
    await removeDirectoryIfEmpty(missionControlRootPath);
  }
  await emit({
    type: "log",
    text: target === "full-uninstall"
      ? `Removed AgentOS state root: ${missionControlRootPath}`
      : `Removed selected AgentOS state under ${missionControlRootPath}`
  });
}

async function runOpenClawNativeTeardown(
  plan: ResetNativeOpenClawPlan | null,
  runner: typeof runOpenClaw,
  emit: ResetEventEmitter
) {
  if (!plan || plan.status !== "ready") {
    return {
      ok: false as const,
      failureClass: "unsupported" as const,
      detail: plan?.reason ?? "The native OpenClaw uninstall preflight did not produce an executable plan."
    };
  }

  await emit({
    type: "status",
    phase: "openclaw-preflight",
    message: "Verifying the native OpenClaw service and state teardown plan..."
  });
  try {
    const preflight = await runner(plan.preflightArgs, { timeoutMs: nativeOpenClawPreflightTimeoutMs });
    await emitCommandOutput(preflight.stdout, emit);
    await emitCommandOutput(preflight.stderr, emit);
  } catch (error) {
    return nativeFailure(error);
  }

  await emit({
    type: "status",
    phase: "openclaw-uninstall",
    message: "Running OpenClaw's native service and state teardown..."
  });
  try {
    const result = await runner(plan.args, { timeoutMs: nativeOpenClawTimeoutMs });
    await emitCommandOutput(result.stdout, emit);
    await emitCommandOutput(result.stderr, emit);
  } catch (error) {
    return nativeFailure(error);
  }

  await emit({
    type: "status",
    phase: "openclaw-preflight",
    message: "Verifying the native OpenClaw teardown result..."
  });
  try {
    const verification = await runner(plan.verificationArgs, { timeoutMs: nativeOpenClawPreflightTimeoutMs });
    await emitCommandOutput(verification.stdout, emit);
    await emitCommandOutput(verification.stderr, emit);
    return { ok: true as const };
  } catch (error) {
    return nativeFailure(error);
  }
}

function nativeFailure(error: unknown) {
  return {
    ok: false as const,
    failureClass: classifyOpenClawUninstallFailure(error),
    detail: safeErrorDetail(error)
  };
}

export function classifyOpenClawUninstallFailure(error: unknown): ResetFailureClass {
  const detail = `${stringifyCommandFailure(error)}\n${error instanceof Error ? error.message : ""}`.toLowerCase();
  if (/timed out|timeout|exceeded its timeout/.test(detail)) return "timeout";
  if (/enoent|not installed|could not be resolved|command not found|failed to start/.test(detail)) return "cli-unavailable";
  if (/unknown option|unknown command|unsupported|unrecognized option|invalid argument/.test(detail)) return "unsupported";
  if (/permission denied|eacces|eperm|not writable|operation not permitted/.test(detail)) return "permission-denied";
  if (/ownership|unmanaged|external|refus|safety/.test(detail)) return "ownership-safety-failed";
  if (/service|gateway|stop|uninstall|launchd|systemd|unit/.test(detail)) return "service-teardown-failed";
  if (/partial|some .* failed|could not remove/.test(detail)) return "partial";
  return "unknown";
}

async function buildNativeOpenClawPlan(runner: typeof runOpenClaw, env: NodeJS.ProcessEnv): Promise<ResetNativeOpenClawPlan> {
  const command = env.OPENCLAW_BIN?.trim() || "openclaw";
  const args = [...openClawNativeUninstallArgs];
  const preflightArgs = [...args, "--dry-run"];
  const statePaths = resolveOpenClawCleanupPaths(env);

  try {
    await runner(preflightArgs, { timeoutMs: nativeOpenClawPreflightTimeoutMs });
    return {
      status: "ready",
      command,
      args,
      preflightCommand: formatOpenClawCommand(command, preflightArgs),
      preflightArgs,
      verificationCommand: formatOpenClawCommand(command, preflightArgs),
      verificationArgs: preflightArgs,
      statePaths,
      preservesConfiguredWorkspaces: true,
      reason: "Native OpenClaw dry-run passed for service and state teardown; configured workspace folders are preserved."
    };
  } catch (error) {
    const failureClass = classifyOpenClawUninstallFailure(error);
    return {
      status: "blocked",
      command,
      args,
      preflightCommand: formatOpenClawCommand(command, preflightArgs),
      preflightArgs,
      verificationCommand: formatOpenClawCommand(command, preflightArgs),
      verificationArgs: preflightArgs,
      statePaths,
      preservesConfiguredWorkspaces: true,
      reason: `Native OpenClaw preflight is blocked (${failureClass}). ${safeErrorDetail(error)}`
    };
  }
}

async function emitCommandOutput(text: string, emit: ResetEventEmitter) {
  const trimmed = redactSecretText(text.trim());
  if (!trimmed) return;
  await emit({ type: "log", text: trimmed });
}

function resolveMissionControlResetPaths(target: ResetTarget) {
  if (target === "full-uninstall") return [missionControlRootPath];
  return [
    missionControlSettingsPath,
    plannerRootPath,
    missionDispatchesRootPath,
    channelRegistryPath,
    telegramRouterRootPath,
    workspaceOwnershipRootPath
  ];
}

function resolveOpenClawCleanupPaths(env: NodeJS.ProcessEnv) {
  return uniqueStrings([resolveOpenClawStateDir(env), resolveOpenClawConfigPath(env)]);
}

async function detectPackageActions(snapshot: MissionControlSnapshot, env: NodeJS.ProcessEnv) {
  const actions: ResetPreviewPackageAction[] = [];
  const preferredManagers = uniqueStrings([
    normalizePackageManager(snapshot.diagnostics.updatePackageManager),
    "pnpm",
    "npm",
    "yarn"
  ].filter((value): value is string => Boolean(value)));
  const openClawPackageName = inferOpenClawPackageName(snapshot);
  const openClawInstallKind = snapshot.diagnostics.updateInstallKind?.trim().toLowerCase();

  if (openClawInstallKind === "package") {
    const manager = normalizePackageManager(snapshot.diagnostics.updatePackageManager);
    const action = manager
      ? await detectGlobalPackageAction(openClawPackageName, [manager], true)
      : null;
    actions.push(action ?? createManualPackageAction(
      openClawPackageName,
      snapshot.diagnostics.updatePackageManager ?? null,
      "OpenClaw reports a package installation, but its package manager is not in AgentOS's supported allowlist."
    ));
  } else {
    actions.push(createAbsentPackageAction(
      openClawPackageName,
      snapshot.diagnostics.updatePackageManager ?? null,
      "OpenClaw is not reported as a package-manager installation."
    ));
  }

  actions.push(await detectAgentOsCleanupAction(preferredManagers, env));
  return actions;
}

async function detectAgentOsCleanupAction(preferredManagers: string[], env: NodeJS.ProcessEnv) {
  const globalPackageAction = await detectGlobalPackageAction("@sapienx/agentos", preferredManagers, true);
  if (globalPackageAction) return globalPackageAction;

  const releaseAction = await detectAgentOsReleaseAction(env);
  if (releaseAction) return releaseAction;

  return createAbsentPackageAction("@sapienx/agentos", null, "No supported AgentOS global package or release installation was detected.");
}

async function detectGlobalPackageAction(
  packageName: string,
  managers: string[],
  required: boolean
): Promise<ResetPreviewPackageAction | null> {
  if (!isSafePackageName(packageName)) {
    return createManualPackageAction(packageName, null, "The detected package name is not safe for automatic removal.");
  }

  for (const manager of managers) {
    if (!supportedPackageManagers.has(manager)) continue;
    const rootPath = await getGlobalPackageRoot(manager);
    if (!rootPath) continue;
    const packagePath = path.join(rootPath, ...packageName.split("/"));
    if (!(await pathExists(packagePath))) continue;

    const args = buildPackageRemovalArgs(manager, packageName);
    return {
      packageName,
      manager,
      command: formatStructuredCommand(manager, args),
      executable: manager,
      args,
      removalMode: "package-manager",
      required,
      detected: true,
      reason: `Detected under ${packagePath}.`
    };
  }

  return null;
}

async function detectAgentOsReleaseAction(env: NodeJS.ProcessEnv): Promise<ResetPreviewPackageAction | null> {
  const defaultScriptPath = path.join(resolveAgentOsRuntimeDir(env), "package", "bin", "agentos.js");
  if (await pathExists(defaultScriptPath)) {
    return createReleasePackageAction(defaultScriptPath, `Detected AgentOS release install at ${path.dirname(path.dirname(defaultScriptPath))}.`);
  }

  const commandPath = await resolveCommandPath("agentos");
  if (!commandPath) return null;
  const launcherContents = await readTextFileIfExists(commandPath);
  const releaseScriptPath = inferAgentOsReleaseScriptPath(launcherContents);
  if (!releaseScriptPath || !(await pathExists(releaseScriptPath))) return null;
  return createReleasePackageAction(releaseScriptPath, `Detected AgentOS release launcher at ${commandPath}.`);
}

function createReleasePackageAction(scriptPath: string, reason: string): ResetPreviewPackageAction {
  const args = [scriptPath, "uninstall", "--yes"];
  return {
    packageName: "@sapienx/agentos",
    manager: null,
    command: formatStructuredCommand(process.execPath, args),
    executable: process.execPath,
    args,
    removalMode: "agentos-release",
    required: true,
    detected: true,
    reason
  };
}

function createAbsentPackageAction(packageName: string, manager: string | null, reason: string): ResetPreviewPackageAction {
  return {
    packageName,
    manager,
    command: null,
    executable: null,
    args: [],
    removalMode: "none",
    required: false,
    detected: false,
    reason
  };
}

function createManualPackageAction(packageName: string, manager: string | null, reason: string): ResetPreviewPackageAction {
  return {
    packageName,
    manager,
    command: null,
    executable: null,
    args: [],
    removalMode: "none",
    required: true,
    detected: false,
    reason
  };
}

function inferOpenClawPackageName(snapshot: MissionControlSnapshot) {
  const candidate = snapshot.diagnostics.updateRoot?.trim() ? path.basename(snapshot.diagnostics.updateRoot.trim()) : "openclaw";
  return isSafePackageName(candidate) && candidate.toLowerCase().includes("openclaw") ? candidate : "openclaw";
}

function buildPackageRemovalArgs(manager: string, packageName: string) {
  if (manager === "pnpm") return ["remove", "-g", packageName];
  if (manager === "yarn") return ["global", "remove", packageName];
  return ["uninstall", "-g", packageName];
}

async function getGlobalPackageRoot(manager: string) {
  if (!supportedPackageManagers.has(manager)) return null;
  try {
    if (manager === "yarn") {
      const { stdout } = await execFileAsync("yarn", ["global", "dir"], {
        cwd: process.cwd(),
        timeout: 15_000,
        maxBuffer: 1024 * 1024
      });
      const globalDir = String(stdout).trim();
      return globalDir ? path.join(globalDir, "node_modules") : null;
    }
    const { stdout } = await execFileAsync(manager, ["root", "-g"], {
      cwd: process.cwd(),
      timeout: 15_000,
      maxBuffer: 1024 * 1024
    });
    const globalRoot = String(stdout).trim();
    return globalRoot || null;
  } catch {
    return null;
  }
}

async function resolveCommandPath(command: string) {
  try {
    const locator = process.platform === "win32" ? "where" : "which";
    const { stdout } = await execFileAsync(locator, [command], {
      cwd: process.cwd(),
      timeout: 10_000,
      maxBuffer: 512 * 1024
    });
    return String(stdout).split(/\r?\n/).map((entry) => entry.trim()).find(Boolean) || null;
  } catch {
    return null;
  }
}

async function readTextFileIfExists(targetPath: string) {
  try {
    return await BunlessReadFile(targetPath);
  } catch {
    return null;
  }
}

async function BunlessReadFile(targetPath: string) {
  const { readFile } = await import("node:fs/promises");
  return readFile(targetPath, "utf8");
}

function inferAgentOsReleaseScriptPath(launcherContents: string | null) {
  if (!launcherContents) return null;
  const normalized = launcherContents.replaceAll("\\", "/");
  const quotedMatch = normalized.match(/["']([^"'\r\n]*\/package\/bin\/agentos\.js)["']/i);
  const bareMatch = normalized.match(/(?:^|[\s(])([^"'()\r\n]*\/package\/bin\/agentos\.js)(?:$|[\s)])/i);
  const candidate = quotedMatch?.[1] ?? bareMatch?.[1];
  if (!candidate || candidate.includes("/node_modules/") || candidate.includes("/.pnpm/")) return null;
  return path.normalize(candidate);
}

export async function scheduleBackgroundPackageRemoval(
  actions: ResetPreviewPackageAction[],
  options: { waitForPid?: number | null; tempDir?: string } = {}
) {
  const safeActions = actions.filter((action) => {
    return action.detected && Boolean(action.executable) && Array.isArray(action.args) && action.args.length >= 0;
  }).map((action) => ({
    packageName: action.packageName,
    executable: action.executable!,
    args: action.args!
  }));
  if (safeActions.length === 0) {
    throw new Error("No safe package-removal actions were available to schedule.");
  }

  const timestamp = Date.now();
  const directory = options.tempDir ?? os.tmpdir();
  const suffix = randomUUID();
  const scriptPath = path.join(directory, `agentos-full-uninstall-${timestamp}-${suffix}.mjs`);
  const specPath = path.join(directory, `agentos-full-uninstall-${timestamp}-${suffix}.json`);
  const logPath = path.join(directory, `agentos-full-uninstall-${timestamp}-${suffix}.log`);
  const spec = {
    actions: safeActions,
    logPath,
    waitForPid: options.waitForPid === undefined ? process.pid : options.waitForPid
  };

  await writeFile(specPath, `${JSON.stringify(spec, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await writeFile(scriptPath, buildPackageRemovalWorkerSource(specPath, scriptPath), { encoding: "utf8", mode: 0o700 });

  const child = spawn(process.execPath, [scriptPath], {
    detached: true,
    stdio: "ignore",
    env: buildDeferredCleanupEnvironment()
  });
  if (!child.pid) {
    await rm(specPath, { force: true }).catch(() => undefined);
    await rm(scriptPath, { force: true }).catch(() => undefined);
    throw new Error("Deferred package cleanup could not be started.");
  }
  child.unref();
  return logPath;
}

function buildPackageRemovalWorkerSource(specPath: string, scriptPath: string) {
  return `import { appendFile, readFile, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const spec = JSON.parse(await readFile(${JSON.stringify(specPath)}, "utf8"));
const log = async (line) => appendFile(spec.logPath, line + "\\n", "utf8");

const isRunning = (pid) => {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error && error.code === "EPERM"; }
};

if (spec.waitForPid) {
  const deadline = Date.now() + 120000;
  while (isRunning(spec.waitForPid) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (isRunning(spec.waitForPid)) {
    await log("Deferred package removal did not start because AgentOS did not exit within 120 seconds.");
    process.exitCode = 75;
  }
}

if (!process.exitCode) {
  for (const action of spec.actions) {
    await log("Running package cleanup: " + action.packageName);
    try {
      await execFileAsync(action.executable, action.args, { timeout: 120000, maxBuffer: 1048576 });
      await log("Completed package cleanup: " + action.packageName);
    } catch (error) {
      const code = error && typeof error.code !== "undefined" ? String(error.code) : "unknown";
      await log("Failed package cleanup: " + action.packageName + " (" + code + ")");
      process.exitCode = 1;
    }
  }
}

await rm(${JSON.stringify(specPath)}, { force: true }).catch(() => undefined);
await rm(${JSON.stringify(scriptPath)}, { force: true }).catch(() => undefined);
`;
}

function buildDeferredCleanupEnvironment(): NodeJS.ProcessEnv {
  const allowedKeys = ["PATH", "HOME", "USER", "TMPDIR", "AGENTOS_RUNTIME_DIR", "AGENTOS_INSTALL_ROOT"];
  return Object.fromEntries(allowedKeys
    .map((key) => [key, process.env[key]])
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")) as NodeJS.ProcessEnv;
}

function formatStructuredCommand(command: string, args: string[]) {
  return [command, ...args].map(quoteShellArg).join(" ");
}

function quoteShellArg(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

async function removeDirectoryIfEmpty(targetPath: string) {
  try {
    const entries = await readdir(targetPath);
    if (entries.length === 0) await rm(targetPath, { recursive: false, force: true });
  } catch {
    // Missing and concurrently changed AgentOS state are harmless here.
  }
}

async function pathExists(targetPath: string) {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values));
}

function isOpenClawStateWorkspacePath(workspacePath: string, stateRoot: string) {
  const resolvedWorkspacePath = path.resolve(workspacePath);
  const resolvedStateRoot = path.resolve(stateRoot);
  return resolvedWorkspacePath === resolvedStateRoot || isPathWithin(resolvedStateRoot, resolvedWorkspacePath);
}

function isPathWithin(rootPath: string, candidatePath: string) {
  const relative = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isProtectedAgentDeleteError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /cannot be deleted|protected agent|protected/i.test(message);
}

function isSafePackageName(value: string) {
  return /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(value);
}

function normalizePackageManager(value: string | null | undefined) {
  const manager = value?.trim().toLowerCase();
  return manager && supportedPackageManagers.has(manager) ? manager : null;
}

function isNodeError(error: unknown, code: string) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}

function safeErrorDetail(error: unknown) {
  const detail = stringifyCommandFailure(error).trim() || (error instanceof Error ? error.message : "Unknown error.");
  return redactSecretText(detail.replace(/\s+/g, " ").slice(0, 360));
}

function finishResetFailure(input: {
  target: ResetTarget;
  status: "failed" | "partial";
  failureClass: ResetFailureClass;
  message: string;
  emit: ResetEventEmitter;
}) {
  return input.emit({
    type: "log",
    text: input.message
  }).then(() => ({
    ok: false,
    status: input.status,
    failureClass: input.failureClass,
    message: input.message
  } satisfies ResetExecutionResult));
}

import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  buildResetPreviewWorkspaces,
  classifyOpenClawUninstallFailure,
  classifyResetWorkspaceOwnership,
  executeReset,
  getResetPreview,
  removeWorkspaceIntegrationArtifacts,
  scheduleBackgroundPackageRemoval,
  type ResetExecutionDependencies
} from "@/lib/openclaw/reset";
import {
  createResetConfirmation,
  consumeResetConfirmation,
  releaseResetConfirmation,
  RESET_PLAN_TTL_MS,
  ResetConfirmationError
} from "@/lib/agentos/reset-confirmation";
import { removeAgentOsRuntimeState } from "@/lib/agentos/runtime-cleanup";
import { requestAgentOsRuntimeShutdown } from "@/lib/agentos/runtime-shutdown";
import type { AgentOsActorContext } from "@/lib/security/agentos-actor";
import type { MissionControlSnapshot, ResetPreview, ResetPreviewWorkspace } from "@/lib/agentos/contracts";
import type { WorkspaceFilesystemOwnershipRecord } from "@/lib/openclaw/domains/workspace-filesystem-ownership";

function ownershipRecord(ownership: WorkspaceFilesystemOwnershipRecord["ownership"]): WorkspaceFilesystemOwnershipRecord {
  return {
    schemaVersion: 1,
    workspacePath: "/tmp/agentos-test-workspace",
    ownership,
    materialization: ownership === "agentos-created-clone" ? "clone" : ownership === "agentos-created-empty" ? "empty" : "existing",
    directoryIdentity: { device: "1", inode: "1" },
    recordedAt: "2026-09-16T00:00:00.000Z"
  };
}

function snapshot(input: {
  workspaces?: Array<{ id: string; name: string; path: string; bootstrap: { sourceMode: "empty" | "clone" | "existing" | null } }>;
  agents?: Array<{ id: string; workspaceId: string; status: string }>;
  runtimes?: Array<{ workspaceId: string; status: string }>;
  diagnostics?: Record<string, unknown>;
} = {}) {
  return {
    workspaces: input.workspaces ?? [],
    agents: input.agents ?? [],
    runtimes: input.runtimes ?? [],
    diagnostics: input.diagnostics ?? {}
  } as unknown as MissionControlSnapshot;
}

function resetPreview(overrides: Partial<ResetPreview> = {}): ResetPreview {
  return {
    target: "full-uninstall",
    generatedAt: "2026-09-16T00:00:00.000Z",
    summary: {
      deleteFolderCount: 0,
      metadataOnlyCount: 0,
      agentCount: 0,
      liveAgentCount: 0,
      activeRuntimeCount: 0
    },
    workspaces: [],
    missionControlPaths: [],
    agentOsRuntimePaths: [],
    browserStorageKeys: [],
    openClawPaths: [],
    nativeOpenClaw: {
      status: "ready",
      command: "openclaw",
      args: ["uninstall", "--service", "--state", "--app", "--yes", "--non-interactive"],
      preflightCommand: "openclaw uninstall --service --state --app --yes --non-interactive --dry-run",
      preflightArgs: ["uninstall", "--service", "--state", "--app", "--yes", "--non-interactive", "--dry-run"],
      statePaths: [],
      preservesConfiguredWorkspaces: true,
      reason: "ready"
    },
    packageActions: [],
    warnings: [],
    ...overrides
  };
}

const unprotectedActor: AgentOsActorContext = {
  actorId: "unprotected-local",
  kind: "instance-operator",
  username: null,
  displayName: null,
  authenticationMethod: "unprotected-local",
  authenticated: false,
  agentOsRole: null
};

test("reset ownership classification requires durable proof and distinguishes all ownership classes", () => {
  const stateRoot = "/tmp/openclaw-state";
  const plannerRoot = "/tmp/agentos-planner-runtime";
  const cases = [
    {
      path: "/tmp/agentos-created",
      record: ownershipRecord("agentos-created-empty"),
      expected: ["AGENTOS_OWNED", "delete-folder"]
    },
    {
      path: "/tmp/openclaw-state/workspace",
      record: null,
      expected: ["OPENCLAW_OWNED", "clean-integration"]
    },
    {
      path: "/tmp/user-folder",
      record: ownershipRecord("user-selected-existing"),
      expected: ["USER_OWNED", "clean-integration"]
    },
    {
      path: "/tmp/unknown-folder",
      record: null,
      expected: ["UNKNOWN", "clean-integration"]
    }
  ] as const;

  for (const entry of cases) {
    const result = classifyResetWorkspaceOwnership({
      workspacePath: entry.path,
      sourceMode: "empty",
      ownershipRecord: entry.record,
      plannerRuntimeWorkspacePath: plannerRoot,
      openClawStateRootPath: stateRoot
    });
    assert.deepEqual([result.ownership, result.action], entry.expected);
  }

  const plannerResult = classifyResetWorkspaceOwnership({
    workspacePath: path.join(plannerRoot, "run-1"),
    sourceMode: null,
    ownershipRecord: null,
    plannerRuntimeWorkspacePath: plannerRoot,
    openClawStateRootPath: stateRoot
  });
  assert.deepEqual([plannerResult.ownership, plannerResult.action], ["AGENTOS_OWNED", "delete-folder"]);
  assert.deepEqual(
    [
      classifyResetWorkspaceOwnership({
        workspacePath: "/tmp/empty-without-proof",
        sourceMode: "empty",
        openClawStateRootPath: stateRoot
      }).ownership,
      classifyResetWorkspaceOwnership({
        workspacePath: "/tmp/clone-without-proof",
        sourceMode: "clone",
        openClawStateRootPath: stateRoot
      }).ownership
    ],
    ["UNKNOWN", "UNKNOWN"]
  );
});

test("integration cleanup removes only the explicit AgentOS marker", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "agentos-reset-integration-"));
  const openClawPath = path.join(rootPath, ".openclaw");
  const markerPath = path.join(openClawPath, "agentos-provisioning.json");
  const userFilePath = path.join(openClawPath, "user-data.json");
  await mkdir(openClawPath, { recursive: true });
  await writeFile(markerPath, `${JSON.stringify({
    manifestVersion: 1,
    agentosProvisioning: {
      manifestVersion: 1,
      runId: "run-1",
      blueprintFingerprint: "fingerprint-1"
    }
  })}\n`);
  await writeFile(userFilePath, "keep\n");

  try {
    const workspace: ResetPreviewWorkspace = {
      workspaceId: "workspace-1",
      name: "Attached workspace",
      path: rootPath,
      sourceMode: "existing",
      ownership: "USER_OWNED",
      action: "clean-integration",
      integrationPaths: [markerPath],
      agentCount: 0,
      runtimeCount: 0,
      liveAgentCount: 0,
      reasons: []
    };
    await removeWorkspaceIntegrationArtifacts(workspace, async () => {});
    await assert.rejects(stat(markerPath), { code: "ENOENT" });
    assert.equal(await readFile(userFilePath, "utf8"), "keep\n");
    await stat(openClawPath);

    await writeFile(markerPath, "{}\n");
    await removeWorkspaceIntegrationArtifacts(workspace, async () => {});
    assert.equal(await readFile(markerPath, "utf8"), "{}\n");
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("preview excludes dynamic OpenClaw state paths and plans native service/state/app scopes", async () => {
  const stateRoot = await mkdtemp(path.join(os.tmpdir(), "agentos-openclaw-state-"));
  const attachedPath = await mkdtemp(path.join(os.tmpdir(), "agentos-attached-"));
  const calls: string[][] = [];
  const currentSnapshot = snapshot({
    workspaces: [
      { id: "state-workspace", name: "OpenClaw state", path: path.join(stateRoot, "workspace"), bootstrap: { sourceMode: "existing" } },
      { id: "attached-workspace", name: "Attached", path: attachedPath, bootstrap: { sourceMode: "existing" } }
    ],
    diagnostics: { updateInstallKind: "source" }
  });

  try {
    const preview = await getResetPreview("full-uninstall", {
      env: { ...process.env, OPENCLAW_STATE_DIR: stateRoot },
      dependencies: {
        getMissionControlSnapshot: async () => currentSnapshot,
        runOpenClaw: async (args) => {
          calls.push(args);
          return { stdout: "dry-run ok", stderr: "" };
        },
        detectPackageActions: async () => []
      }
    });

    assert.deepEqual(preview.workspaces.map((workspace) => workspace.workspaceId), ["attached-workspace"]);
    assert.equal(preview.nativeOpenClaw?.status, "ready");
    assert.deepEqual(preview.nativeOpenClaw?.args, ["uninstall", "--service", "--state", "--app", "--yes", "--non-interactive"]);
    assert.equal(preview.nativeOpenClaw?.args.includes("--workspace"), false);
    assert.equal(preview.nativeOpenClaw?.args.includes("--all"), false);
    assert.equal(preview.nativeOpenClaw?.preflightArgs.includes("--workspace"), false);
    assert.equal(preview.nativeOpenClaw?.preflightArgs.includes("--all"), false);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].includes("--dry-run"), true);
    assert.equal(preview.openClawPaths.includes(stateRoot), true);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
    await rm(attachedPath, { recursive: true, force: true });
  }
});

test("full uninstall runs native preflight and teardown, then AgentOS cleanup, runtime cleanup, and package scheduling", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "agentos-reset-order-"));
  const calls: string[] = [];
  let scheduledPids: Array<number | null> = [];
  const currentSnapshot = snapshot();
  const preview = resetPreview({
    packageActions: [{
      packageName: "@sapienx/agentos",
      manager: null,
      command: "/usr/bin/true",
      executable: "/usr/bin/true",
      args: [],
      removalMode: "agentos-release",
      required: true,
      detected: true,
      reason: "test"
    }]
  });
  const dependencies: ResetExecutionDependencies = {
    runOpenClaw: async (args) => {
      calls.push(`openclaw:${args.join(" ")}`);
      return { stdout: "", stderr: "" };
    },
    runAgentOsCleanup: async (_preview, emit) => {
      calls.push("agentos-workspaces");
      await emit({ type: "status", phase: "agentos-workspaces", message: "test" });
      calls.push("agentos-state");
    },
    removeAgentOsRuntimeState: async () => {
      calls.push("runtime");
      return [];
    },
    schedulePackageRemoval: async (_actions, options) => {
      calls.push("package");
      scheduledPids = options?.waitForPids ?? [];
      return path.join(rootPath, "cleanup.log");
    },
    clearMissionControlCaches: () => calls.push("cache"),
    resetOpenClawBinCache: () => calls.push("bin-cache"),
    getMissionControlSnapshot: async () => currentSnapshot
  };

  try {
    const result = await executeReset("full-uninstall", {
      preview,
      dependencies,
      env: {
        ...process.env,
        AGENTOS_LAUNCHER_PID: String(process.pid + 1),
        AGENTOS_RUNTIME_DIR: path.join(rootPath, "runtime")
      },
      onEvent: async (event) => {
        if (event.type === "status") calls.push(`phase:${event.phase}`);
      }
    });

    assert.equal(result.ok, true);
    assert.equal(result.status, "scheduled");
    assert.deepEqual(calls.slice(0, 4), [
      "phase:planning",
      "phase:openclaw-preflight",
      "openclaw:uninstall --service --state --app --yes --non-interactive --dry-run",
      "phase:openclaw-uninstall"
    ]);
    const nativeCalls = calls.filter((entry) => entry.startsWith("openclaw:"));
    assert.deepEqual(nativeCalls, [
      "openclaw:uninstall --service --state --app --yes --non-interactive --dry-run",
      "openclaw:uninstall --service --state --app --yes --non-interactive"
    ]);
    assert.equal(calls.indexOf("agentos-workspaces") > calls.indexOf("openclaw:uninstall --service --state --app --yes --non-interactive"), true);
    assert.equal(calls.indexOf("runtime") > calls.indexOf("agentos-state"), true);
    assert.equal(calls.indexOf("package") > calls.indexOf("runtime"), true);
    assert.equal(calls.indexOf("phase:refreshing") > calls.indexOf("package"), true);
    assert.equal(result.runtimeShutdownEligible, true);
    assert.deepEqual(scheduledPids, [process.pid, process.pid + 1]);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("Reset AgentOS never invokes the OpenClaw uninstall CLI", async () => {
  const calls: string[] = [];
  const preview = resetPreview({
    target: "mission-control",
    nativeOpenClaw: null
  });
  const result = await executeReset("mission-control", {
    preview,
    dependencies: {
      runOpenClaw: async () => {
        calls.push("openclaw");
        throw new Error("Reset AgentOS must not uninstall OpenClaw.");
      },
      runAgentOsCleanup: async () => {
        calls.push("agentos");
      },
      clearMissionControlCaches: () => calls.push("cache"),
      getMissionControlSnapshot: async () => snapshot()
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, "succeeded");
  assert.deepEqual(calls, ["agentos", "cache"]);
});

test("source or repository installs remain preserved and make the result partial", async () => {
  const logs: string[] = [];
  const preview = resetPreview({
    packageActions: [{
      packageName: "@sapienx/agentos",
      manager: null,
      command: null,
      executable: null,
      args: [],
      removalMode: "none",
      required: true,
      detected: true,
      reason: "AgentOS is running from a development/source checkout; the repository is preserved for manual removal."
    }]
  });

  const result = await executeReset("full-uninstall", {
    preview,
    dependencies: {
      runOpenClaw: async () => ({ stdout: "", stderr: "" }),
      runAgentOsCleanup: async () => {},
      removeAgentOsRuntimeState: async () => [],
      schedulePackageRemoval: async () => {
        throw new Error("A preserved source checkout must not be scheduled.");
      },
      clearMissionControlCaches: () => {},
      getMissionControlSnapshot: async () => snapshot()
    },
    onEvent: async (event) => {
      if (event.type === "log") logs.push(event.text);
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, "partial");
  assert.equal(result.failureClass, "partial");
  assert.match(logs.join("\n"), /manual package cleanup remains/i);
});

test("blocked native preflight is actionable and does not enter AgentOS cleanup", async () => {
  const calls: string[] = [];
  const preview = resetPreview({
    nativeOpenClaw: {
      ...resetPreview().nativeOpenClaw!,
      status: "blocked",
      reason: "Native OpenClaw preflight is blocked (cli-unavailable)."
    }
  });
  const result = await executeReset("full-uninstall", {
    preview,
    dependencies: {
      runOpenClaw: async () => {
        calls.push("openclaw");
        return { stdout: "", stderr: "" };
      },
      runAgentOsCleanup: async () => {
        calls.push("agentos");
      },
      removeAgentOsRuntimeState: async () => {
        calls.push("runtime");
        return [];
      }
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.failureClass, "unsupported");
  assert.match(result.message, /did not mutate OpenClaw state/);
  assert.deepEqual(calls, []);
});

test("native OpenClaw failure stops all AgentOS and package cleanup", async () => {
  const calls: string[] = [];
  const preview = resetPreview();
  const failure = Object.assign(new Error("OpenClaw command failed"), {
    stderr: "Failed to stop gateway service: permission denied",
    stdout: ""
  });
  const result = await executeReset("full-uninstall", {
    preview,
    dependencies: {
      runOpenClaw: async () => {
        calls.push("native");
        throw failure;
      },
      runAgentOsCleanup: async () => {
        calls.push("agentos");
      },
      removeAgentOsRuntimeState: async () => {
        calls.push("runtime");
        return [];
      },
      schedulePackageRemoval: async () => {
        calls.push("package");
        return "/tmp/never.log";
      }
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, "failed");
  assert.equal(result.failureClass, "permission-denied");
  assert.equal(result.runtimeShutdownEligible, undefined);
  assert.deepEqual(calls, ["native"]);
});

test("native uninstall failure classes remain differentiated", () => {
  const cases: Array<[string, string, string]> = [
    ["cli-unavailable", "OpenClaw command failed to start: ENOENT", "cli-unavailable"],
    ["unsupported", "Unknown option --state", "unsupported"],
    ["permission", "permission denied while removing state", "permission-denied"],
    ["service", "gateway service could not be stopped", "service-teardown-failed"],
    ["timeout", "OpenClaw command timed out after 45 seconds", "timeout"]
  ];
  for (const [, message, expected] of cases) {
    assert.equal(classifyOpenClawUninstallFailure(new Error(message)), expected);
  }
});

test("integration cleanup refuses a directory at the explicit marker path", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "agentos-reset-marker-directory-"));
  const markerPath = path.join(rootPath, ".openclaw", "agentos-provisioning.json");
  await mkdir(markerPath, { recursive: true });
  const workspace: ResetPreviewWorkspace = {
    workspaceId: "workspace-marker-directory",
    name: "Marker directory",
    path: rootPath,
    sourceMode: "existing",
    ownership: "USER_OWNED",
    action: "clean-integration",
    integrationPaths: [markerPath],
    agentCount: 0,
    runtimeCount: 0,
    liveAgentCount: 0,
    reasons: []
  };

  try {
    await assert.rejects(
      removeWorkspaceIntegrationArtifacts(workspace, async () => {}),
      /not a regular file/
    );
    await stat(markerPath);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("reset confirmation is actor/session/target bound, expires, and is one-use", async () => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "agentos-reset-plan-"));
  const env = { ...process.env, AGENTOS_RUNTIME_DIR: runtimeRoot };
  const request = new Request("http://agentos.test/api/reset");
  const preview = resetPreview({ target: "mission-control" });
  const now = new Date("2026-09-16T00:00:00.000Z");

  try {
    const ticket = await createResetConfirmation({ preview, actor: unprotectedActor, request, env, now });
    const consumed = await consumeResetConfirmation({
      planId: ticket.planId,
      target: "mission-control",
      actor: unprotectedActor,
      request,
      env,
      now: new Date(now.getTime() + 1)
    });
    assert.deepEqual(consumed.preview, preview);
    await assert.rejects(
      consumeResetConfirmation({
        planId: ticket.planId,
        target: "mission-control",
        actor: unprotectedActor,
        request,
        env,
        now: new Date(now.getTime() + 2)
      }),
      (error: unknown) => error instanceof ResetConfirmationError && error.code === "reset-plan-in-use"
    );
    await releaseResetConfirmation(consumed, env);

    const expiring = await createResetConfirmation({ preview, actor: unprotectedActor, request, env, now });
    await assert.rejects(
      consumeResetConfirmation({
        planId: expiring.planId,
        target: "mission-control",
        actor: unprotectedActor,
        request,
        env,
        now: new Date(now.getTime() + RESET_PLAN_TTL_MS + 1)
      }),
      (error: unknown) => error instanceof ResetConfirmationError && error.code === "reset-plan-expired"
    );
  } finally {
    await rm(runtimeRoot, { recursive: true, force: true });
  }
});

test("reset confirmation rejects a changed target and actor without consuming the plan", async () => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "agentos-reset-plan-binding-"));
  const env = { ...process.env, AGENTOS_RUNTIME_DIR: runtimeRoot };
  const request = new Request("http://agentos.test/api/reset");
  const preview = resetPreview({ target: "mission-control" });
  const now = new Date("2026-09-16T00:00:00.000Z");
  const differentActor = { ...unprotectedActor, actorId: "different-operator" };

  try {
    const ticket = await createResetConfirmation({ preview, actor: unprotectedActor, request, env, now });
    await assert.rejects(
      consumeResetConfirmation({
        planId: ticket.planId,
        target: "full-uninstall",
        actor: unprotectedActor,
        request,
        env,
        now
      }),
      (error: unknown) => error instanceof ResetConfirmationError && error.code === "reset-plan-target-mismatch"
    );
    await assert.rejects(
      consumeResetConfirmation({
        planId: ticket.planId,
        target: "mission-control",
        actor: differentActor,
        request,
        env,
        now
      }),
      (error: unknown) => error instanceof ResetConfirmationError && error.code === "reset-plan-actor-mismatch"
    );
  } finally {
    await rm(runtimeRoot, { recursive: true, force: true });
  }
});

test("reset confirmation rejects a changed API session binding", async () => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "agentos-reset-plan-session-"));
  const env = { ...process.env, AGENTOS_RUNTIME_DIR: runtimeRoot };
  const actor: AgentOsActorContext = {
    ...unprotectedActor,
    actorId: "service:reset-test",
    kind: "service",
    authenticationMethod: "api-token",
    authenticated: true,
    agentOsRole: "owner"
  };
  const preview = resetPreview();
  const now = new Date("2026-09-16T00:00:00.000Z");
  const originalRequest = new Request("http://agentos.test/api/reset", { headers: { "x-agentos-api-token": "first" } });
  const changedRequest = new Request("http://agentos.test/api/reset", { headers: { "x-agentos-api-token": "second" } });

  try {
    const ticket = await createResetConfirmation({ preview, actor, request: originalRequest, env, now });
    await assert.rejects(
      consumeResetConfirmation({
        planId: ticket.planId,
        target: "full-uninstall",
        actor,
        request: changedRequest,
        env,
        now
      }),
      (error: unknown) => error instanceof ResetConfirmationError && error.code === "reset-plan-session-mismatch"
    );
  } finally {
    await rm(runtimeRoot, { recursive: true, force: true });
  }
});

test("AgentOS runtime cleanup honors AGENTOS_RUNTIME_DIR and preserves unknown/package state", async () => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "agentos-runtime-cleanup-"));
  const env = { ...process.env, AGENTOS_RUNTIME_DIR: runtimeRoot };
  const keepPath = path.join(runtimeRoot, "keep-me.txt");
  const packagePath = path.join(runtimeRoot, "package", "bin", "agentos.js");
  await mkdir(path.dirname(packagePath), { recursive: true });
  await mkdir(path.join(runtimeRoot, "run"), { recursive: true });
  await mkdir(path.join(runtimeRoot, "cache"), { recursive: true });
  await mkdir(path.join(runtimeRoot, "reset-plans"), { recursive: true });
  await writeFile(keepPath, "keep\n");
  await writeFile(packagePath, "package\n");
  await writeFile(path.join(runtimeRoot, "api-token"), "secret\n");
  await writeFile(path.join(runtimeRoot, "run", "agentos-4310.json"), "{}\n");
  await writeFile(path.join(runtimeRoot, "cache", "update-check.json"), "{}\n");

  try {
    await removeAgentOsRuntimeState(env);
    await assert.rejects(stat(path.join(runtimeRoot, "api-token")), { code: "ENOENT" });
    await assert.rejects(stat(path.join(runtimeRoot, "run")), { code: "ENOENT" });
    assert.equal(await readFile(keepPath, "utf8"), "keep\n");
    assert.equal(await readFile(packagePath, "utf8"), "package\n");
  } finally {
    await rm(runtimeRoot, { recursive: true, force: true });
  }
});

test("runtime cleanup preserves unknown reset-plan files", async () => {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "agentos-runtime-plan-preserve-"));
  const env = { ...process.env, AGENTOS_RUNTIME_DIR: runtimeRoot };
  const resetPlansRoot = path.join(runtimeRoot, "reset-plans");
  const unknownPlanPath = path.join(resetPlansRoot, "not-an-agentos-plan.json");
  await mkdir(resetPlansRoot, { recursive: true });
  await writeFile(unknownPlanPath, "keep\n");

  try {
    await removeAgentOsRuntimeState(env);
    assert.equal(await readFile(unknownPlanPath, "utf8"), "keep\n");
  } finally {
    await rm(runtimeRoot, { recursive: true, force: true });
  }
});

test("deferred package cleanup waits for every AgentOS runtime pid before executing", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentos-package-scheduler-"));
  const releaseScriptPath = path.join(tempDir, "package", "bin", "agentos.js");
  await mkdir(path.dirname(releaseScriptPath), { recursive: true });
  await writeFile(releaseScriptPath, "process.exit(0);\n");
  const runtimeProcess = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  const launcherProcess = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  assert.ok(runtimeProcess.pid);
  assert.ok(launcherProcess.pid);
  const action = {
    packageName: "test-package",
    manager: null,
    command: `${process.execPath} ${releaseScriptPath} uninstall --yes`,
    executable: process.execPath,
    args: [releaseScriptPath, "uninstall", "--yes"],
    removalMode: "agentos-release" as const,
    required: true,
    detected: true,
    reason: "test"
  };

  try {
    const logPath = await scheduleBackgroundPackageRemoval([action], {
      tempDir,
      waitForPids: [runtimeProcess.pid, launcherProcess.pid]
    });
    assert.match(logPath, /agentos-full-uninstall-.*\.log$/);
    await waitForFileMatch(logPath, /Waiting for AgentOS runtime exit/);
    assert.doesNotMatch(await readFile(logPath, "utf8"), /Completed package cleanup: test-package/);
    runtimeProcess.kill("SIGTERM");
    await waitForChildExit(runtimeProcess);
    assert.doesNotMatch(await readFile(logPath, "utf8"), /Completed package cleanup: test-package/);
    launcherProcess.kill("SIGTERM");
    await waitForChildExit(launcherProcess);
    await waitForFileMatch(logPath, /Completed package cleanup: test-package/);
    assert.match(await readFile(logPath, "utf8"), /Completed package cleanup: test-package/);
    assert.match(await readFile(logPath, "utf8"), /Finalizer result: succeeded; 1 package cleanup\(s\) completed\./);
  } finally {
    if (runtimeProcess.exitCode === null && runtimeProcess.signalCode === null) {
      runtimeProcess.kill("SIGKILL");
      await waitForChildExit(runtimeProcess).catch(() => undefined);
    }
    if (launcherProcess.exitCode === null && launcherProcess.signalCode === null) {
      launcherProcess.kill("SIGKILL");
      await waitForChildExit(launcherProcess).catch(() => undefined);
    }
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("deferred package cleanup records an explicit timeout and skips package execution", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentos-package-timeout-"));
  const releaseScriptPath = path.join(tempDir, "package", "bin", "agentos.js");
  await mkdir(path.dirname(releaseScriptPath), { recursive: true });
  await writeFile(releaseScriptPath, "process.exit(0);\n");
  const runtimeProcess = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  assert.ok(runtimeProcess.pid);
  const action = {
    packageName: "timeout-package",
    manager: null,
    command: `${process.execPath} ${releaseScriptPath} uninstall --yes`,
    executable: process.execPath,
    args: [releaseScriptPath, "uninstall", "--yes"],
    removalMode: "agentos-release" as const,
    required: true,
    detected: true,
    reason: "test"
  };

  try {
    const logPath = await scheduleBackgroundPackageRemoval([action], {
      tempDir,
      waitForPids: [runtimeProcess.pid],
      waitTimeoutMs: 150
    });
    await waitForFileMatch(logPath, /Finalizer result: timed-out; package cleanup skipped\./, 3_000);
    const log = await readFile(logPath, "utf8");
    assert.match(log, /after 150ms/);
    assert.doesNotMatch(log, /Running package cleanup: timeout-package/);
  } finally {
    if (runtimeProcess.exitCode === null && runtimeProcess.signalCode === null) {
      runtimeProcess.kill("SIGKILL");
      await waitForChildExit(runtimeProcess).catch(() => undefined);
    }
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("runtime shutdown uses the launcher handoff only after the response flush turn", async () => {
  const calls: string[] = [];
  const result = await requestAgentOsRuntimeShutdown({
    env: { ...process.env, AGENTOS_LAUNCHER_PID: "902" },
    pid: 903,
    waitForResponseFlush: async () => {
      calls.push("response-flush");
    },
    send: (_message, callback) => {
      calls.push("launcher-ipc");
      callback?.();
      return true;
    },
    kill: () => {
      calls.push("self-signal");
    }
  });

  assert.deepEqual(calls, ["response-flush", "launcher-ipc"]);
  assert.deepEqual(result, { requested: true, mode: "launcher-ipc", launcherPid: 902 });
});

test("source runtime shutdown self-signals only after the response flush turn", async () => {
  const calls: string[] = [];
  const result = await requestAgentOsRuntimeShutdown({
    env: { ...process.env },
    pid: 903,
    waitForResponseFlush: async () => {
      calls.push("response-flush");
    },
    kill: (pid, signal) => {
      calls.push(`${pid}:${signal}`);
    }
  });

  assert.deepEqual(calls, ["response-flush", "903:SIGTERM"]);
  assert.deepEqual(result, { requested: true, mode: "self-signal", launcherPid: null });
});

test("preview workspace construction remains executable with attached and managed records", async () => {
  const managedPath = await mkdtemp(path.join(os.tmpdir(), "agentos-managed-preview-"));
  const attachedPath = await mkdtemp(path.join(os.tmpdir(), "agentos-attached-preview-"));
  try {
    const result = await buildResetPreviewWorkspaces(snapshot({
      workspaces: [
        { id: "managed", name: "Managed", path: managedPath, bootstrap: { sourceMode: "empty" } },
        { id: "attached", name: "Attached", path: attachedPath, bootstrap: { sourceMode: "existing" } }
      ]
    }), "mission-control");
    assert.deepEqual(result.map((entry) => entry.action), ["clean-integration", "clean-integration"]);
    assert.deepEqual(result.map((entry) => entry.ownership), ["UNKNOWN", "UNKNOWN"]);
  } finally {
    await rm(managedPath, { recursive: true, force: true });
    await rm(attachedPath, { recursive: true, force: true });
  }
});

async function waitForChildExit(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve, reject) => {
    child.once("exit", () => resolve());
    child.once("error", reject);
  });
}

async function waitForFileMatch(filePath: string, pattern: RegExp, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const contents = await readFile(filePath, "utf8");
      if (pattern.test(contents)) return contents;
    } catch {
      // The worker may not have created the log yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(`Timed out waiting for ${filePath} to match ${pattern}.`);
}

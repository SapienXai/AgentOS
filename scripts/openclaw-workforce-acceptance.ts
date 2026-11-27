import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { promisify } from "node:util";

import { downloadWorkforceMissionArtifact, getWorkforceMissionDetail, getWorkforceMissionList } from "@/lib/agentos/application/workforce-service";
import type { WorkforceArtifact } from "@/lib/agentos/workforce/types";
import { abortMissionTask, clearMissionControlCaches, createAgent, getMissionControlSnapshot, submitMission } from "@/lib/agentos/control-plane";
import { getOpenClawAdapter, setOpenClawAdapterForTesting } from "@/lib/openclaw/adapter/openclaw-adapter";
import type { OpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import { resetOpenClawGatewayClient, setOpenClawGatewayClientForTesting } from "@/lib/openclaw/client/gateway-client-factory";
import { readMissionDispatchRecordById, readMissionDispatchRecords } from "@/lib/openclaw/domains/mission-dispatch-lifecycle";
import type { MissionDispatchRecord } from "@/lib/openclaw/domains/mission-dispatch-lifecycle";
import { resolveMissionDispatchResultText } from "@/lib/openclaw/domains/mission-dispatch-model";
import { buildTaskRecords } from "@/lib/openclaw/domains/task-records";
import { resolveModelReadiness } from "@/lib/openclaw/domains/control-plane-normalization";
import { mapOpenClawTaskListToRuntimes } from "@/lib/openclaw/application/runtime-state-service";
import { settleSessionsPayloadFromOpenClaw } from "@/lib/openclaw/application/mission-control/payload-loader";
import { parseRuntimeOutputFromSessionHistory } from "@/lib/openclaw/domains/runtime-transcript";
import {
  getHumanControlInbox,
  projectApprovalRecords,
  projectQuestionRecords,
  resolveAttentionItem
} from "@/lib/openclaw/application/human-control-inbox-service";
import { createOfficialBackedOpenClawGatewayClient } from "@/lib/openclaw/client/official-gateway-factory";
import { createDisposableOpenClawEnvironment, isDisposableProcessStopped, stopDisposableProcess } from "@/scripts/lib/disposable-openclaw-env";
import { REQUIRED_WORKFORCE_PRODUCT_CHECKS } from "@/scripts/lib/workforce-certification-requirements";
import {
  OPENCLAW_CERTIFICATION_TARGET_BUILD as OPENCLAW_IDENTITY_CONTRACT_BUILD,
  OPENCLAW_CERTIFICATION_TARGET_COMMIT as OPENCLAW_IDENTITY_CONTRACT_SOURCE_COMMIT,
  OPENCLAW_CERTIFICATION_TARGET_VERSION as OPENCLAW_IDENTITY_CONTRACT_VERSION
} from "@/lib/openclaw/certification-target";
import { createOpenClawRuntimeProviderFixture } from "@/scripts/openclaw-runtime-provider-fixture";

const execFileAsync = promisify(execFile);
const PACKAGE_INPUT = process.env.OPENCLAW_WORKFORCE_PACKAGE?.trim();
const OUTPUT_PATH = path.resolve(process.env.OPENCLAW_WORKFORCE_OUTPUT?.trim() || `docs/evidence/openclaw-${OPENCLAW_IDENTITY_CONTRACT_VERSION}-workforce-acceptance.json`);
const TIMEOUT_MS = 10_000;
const LIVE_EVIDENCE_CLASS = `LIVE_DISPOSABLE_${OPENCLAW_IDENTITY_CONTRACT_VERSION.replaceAll(".", "_")}`;

type GatewayClient = ReturnType<typeof createOfficialBackedOpenClawGatewayClient>;
type CheckStatus = "PASS" | "SKIPPED" | "FAIL";

async function main() {
  if (!PACKAGE_INPUT) throw new Error(`Set OPENCLAW_WORKFORCE_PACKAGE to an exact OpenClaw ${OPENCLAW_IDENTITY_CONTRACT_VERSION} package root.`);
  const packageRoot = path.resolve(PACKAGE_INPUT);
  const identity = await readPackageIdentity(packageRoot);
  assert.deepEqual(identity, {
    version: OPENCLAW_IDENTITY_CONTRACT_VERSION,
    sourceCommit: OPENCLAW_IDENTITY_CONTRACT_SOURCE_COMMIT,
    buildId: OPENCLAW_IDENTITY_CONTRACT_BUILD,
    packageHash: identity.packageHash
  });

  const disposableRoot = process.env.AGENTOS_WORKFORCE_TEST_ROOT;
  if (!disposableRoot) throw new Error("Launch acceptance with pnpm openclaw:workforce-e2e.");
  const stateDir = path.join(disposableRoot, "state");
  const workspaceDir = path.join(disposableRoot, "workspace");
  const configPath = path.join(disposableRoot, "openclaw.json");
  const port = await reservePort();
  const token = `agentos-workforce-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const fixture = await createOpenClawRuntimeProviderFixture({ modelId: "workforce-check-model" });
  let gateway: ChildProcess | null = null;
  let client: GatewayClient | null = null;
  let sessionKey: string | null = null;
  const parentEnvironment = captureEnvironment([
    "AGENTOS_OPENCLAW_GATEWAY_URL",
    "AGENTOS_OPENCLAW_GATEWAY_TOKEN",
    "OPENCLAW_GATEWAY_URL",
    "OPENCLAW_GATEWAY_TOKEN",
    "OPENCLAW_CONFIG_PATH",
    "OPENCLAW_STATE_DIR",
    "OPENCLAW_BIN"
  ]);
  const cleanupRefs = { questionIds: [] as string[], sessionKeys: [] as string[], approvalId: null as string | null };
  const evidence = createEvidence(identity, await readGitHead());

  try {
    await mkdir(workspaceDir, { recursive: true, mode: 0o700 });
    await mkdir(stateDir, { recursive: true, mode: 0o700 });
    await writeConfig(configPath, workspaceDir, fixture.baseUrl, fixture.modelId, token);
    gateway = await startGateway({ packageRoot, stateDir, workspaceDir, configPath, port, token });
    client = createClient(port, token, "0.1.0-agentos-workforce-acceptance", stateDir);
    process.env.AGENTOS_OPENCLAW_GATEWAY_URL = `ws://127.0.0.1:${port}`;
    process.env.AGENTOS_OPENCLAW_GATEWAY_TOKEN = token;
    process.env.OPENCLAW_GATEWAY_URL = `ws://127.0.0.1:${port}`;
    process.env.OPENCLAW_GATEWAY_TOKEN = token;
    process.env.OPENCLAW_CONFIG_PATH = configPath;
    process.env.OPENCLAW_STATE_DIR = stateDir;
    process.env.OPENCLAW_BIN = path.join(packageRoot, "openclaw.mjs");
    setOpenClawGatewayClientForTesting(client);
    setOpenClawAdapterForTesting(null);
    clearMissionControlCaches();

    const handshake = await client.probeNativeHandshake({ timeoutMs: TIMEOUT_MS }) as Record<string, unknown>;
    const server = asRecord(handshake.server);
    assert.equal(server?.version, OPENCLAW_IDENTITY_CONTRACT_VERSION);
    assert.equal(handshake.protocol, 4);
    const operatorIdentity = await client.getOperatorIdentity({ timeoutMs: TIMEOUT_MS });
    assert.equal(operatorIdentity.authenticated, true);
    evidence.runtime = {
      version: server?.version ?? null,
      protocol: handshake.protocol ?? null,
      authenticated: operatorIdentity.authenticated,
      grantedScopes: operatorIdentity.grantedScopes,
      deviceIdentity: "canonical OpenClaw identity created inside the disposable state directory",
      loopback: true,
      isolatedState: true,
      securityDefaults: "tools.sessions.visibility=tree; tools.agentToAgent.enabled=false; tools.agentToAgent.allow=[]"
    };
    evidence.checks["runtime-identity"] = { status: "PASS", evidence: LIVE_EVIDENCE_CLASS };

    const modelAuthResult = await client.callNative<Record<string, unknown>>(
      "models.authSetApiKey",
      { provider: "openai", apiKey: "sk-agentos-workforce-fixture-00000000", agentId: "main" },
      mutationOptions()
    );
    assert.equal(typeof modelAuthResult.profileId, "string");
    evidence.modelAuthSetup = {
      method: "models.authSetApiKey",
      scope: "operator.admin",
      provider: "openai",
      profileId: modelAuthResult.profileId,
      warning: modelAuthResult.warning ?? null,
      credentialLocation: "isolated disposable OpenClaw agent profile"
    };
    evidence.checks["disposable-model-auth"] = {
      status: "PASS",
      evidence: ["OPENCLAW_NATIVE_GATEWAY", LIVE_EVIDENCE_CLASS],
      detail: "OpenClaw stored the fixture-only API key in the disposable main-agent profile through its administrator-authorized native Gateway method."
    };

    const selectedModel = `openai/${fixture.modelId}`;
    try {
      const [modelCatalog, modelStatus] = await readFixtureModelState(client, selectedModel);
      evidence.modelReadiness = {
        selectedModel,
        readiness: resolveModelReadiness(modelCatalog.models, modelStatus, [selectedModel]),
        models: modelCatalog.models.map((model) => ({
          key: model.key,
          provider: model.provider,
          available: model.available,
          local: model.local
        })),
        defaultModel: modelStatus.defaultModel ?? null,
        resolvedDefault: modelStatus.resolvedDefault ?? null,
        allowed: modelStatus.allowed ?? [],
        authProviders: (modelStatus.auth?.providers ?? []).map((provider) => ({
          provider: provider.provider ?? null,
          kind: provider.effective?.kind ?? null,
          profileCount: provider.profiles?.count ?? 0,
          apiKeyProfiles: provider.profiles?.apiKey ?? 0,
          tokenProfiles: provider.profiles?.token ?? 0
        })),
        missingProvidersInUse: modelStatus.auth?.missingProvidersInUse ?? [],
        fallbackCounts: client.getDiagnostics?.().fallbackCounts ?? {}
      };
    } catch (error) {
      evidence.modelReadiness = {
        selectedModel,
        error: sanitizeText(error instanceof Error ? error.message : "Model readiness probe failed.")
      };
    }

    const requestId = `workforce-product-path-${Date.now()}`;
    const productMission = await submitMission({
      mission: "WORKFORCE_ACCEPTANCE_FIRST",
      requestId,
      agentId: "main",
      thinking: "off"
    }, mutationOptions());
    assert.ok(productMission.dispatchId);
    let dispatchRecord = await readMissionDispatchRecordById(productMission.dispatchId);
    assert.ok(dispatchRecord);
    assert.equal(dispatchRecord.clientRequestId, requestId);
    assert.equal(dispatchRecord.agentId, "main");
    assert.ok(dispatchRecord.result?.sessionKey, JSON.stringify({ status: dispatchRecord.status, result: dispatchRecord.result, error: dispatchRecord.error }));
    assert.ok(dispatchRecord.result?.runId);
    sessionKey = dispatchRecord.result.sessionKey ?? null;
    assert.ok(sessionKey);
    let productSnapshot = await getMissionControlSnapshot({ force: true });
    try {
      dispatchRecord = await waitForDispatchTerminal(productMission.dispatchId, async () => {
        productSnapshot = await getMissionControlSnapshot({ force: true });
      });
    } catch (error) {
      const latestRecord = await readMissionDispatchRecordById(productMission.dispatchId).catch(() => null);
      const diagnosticSnapshot = await getMissionControlSnapshot({ force: true }).catch(() => productSnapshot);
      const history = client && sessionKey
        ? await readHistory(client, sessionKey, 1).catch(() => [])
        : [];
      const historyLifecycle = client && sessionKey
        ? await readHistoryLifecycleEvidence(client, sessionKey, latestRecord).catch(() => ({
            assistantMessageCount: 0,
            expectedReplyHasStopReason: false,
            expectedReplyStopReason: "unavailable",
            latestAssistantHasStopReason: false,
            latestAssistantStopReason: "unavailable",
            parsedOutput: null
          }))
        : {
            assistantMessageCount: 0,
            expectedReplyHasStopReason: false,
            expectedReplyStopReason: "unavailable",
            latestAssistantHasStopReason: false,
            latestAssistantStopReason: "unavailable",
            parsedOutput: null
          };
      const relatedRunId = latestRecord?.result?.runId ?? null;
      evidence.reconciliationDiagnostic = {
        dispatchStatus: latestRecord?.status ?? null,
        admissionState: latestRecord?.admissionState ?? null,
        hasSessionKey: Boolean(latestRecord?.sessionKey),
        hasSessionId: Boolean(latestRecord?.sessionId),
        hasRunId: Boolean(relatedRunId),
        hasFixtureCompletion: fixture.stats.completionCount > 0,
        expectedReplyInNativeHistory: history.includes("AGENTOS_FIXTURE_FIRST_REPLY"),
        historyLifecycle,
        matchingRuntimeStatuses: diagnosticSnapshot.runtimes
          .filter((runtime) => Boolean(
            (latestRecord?.sessionId && runtime.sessionId === latestRecord.sessionId) ||
            (relatedRunId && runtime.runId === relatedRunId)
          ))
          .map((runtime) => ({
            source: runtime.source,
            status: runtime.status,
            hasSessionId: Boolean(runtime.sessionId),
            hasRunId: Boolean(runtime.runId),
            sessionIdMatchesDispatch: Boolean(latestRecord?.sessionId && runtime.sessionId === latestRecord.sessionId),
            matchesAcceptedRunId: Boolean(relatedRunId && runtime.runId === relatedRunId),
            matchesDispatchMetadata: runtime.metadata.dispatchId === latestRecord?.id
          })),
        timeout: sanitizeText(error instanceof Error ? error.message : "Task completion was not observed.")
      };
      throw error;
    }
    const missionList = await getWorkforceMissionList({ snapshot: productSnapshot });
    const listedMission = missionList.missions.find((mission) => mission.id === productMission.dispatchId);
    assert.ok(listedMission);
    const missionDetail = await getWorkforceMissionDetail(productMission.dispatchId, { snapshot: productSnapshot });
    assert.ok(missionDetail);
    assert.equal(missionDetail.id, productMission.dispatchId);
    const finalResult = resolveMissionDispatchResultText(dispatchRecord);
    assert.equal(finalResult, "AGENTOS_FIXTURE_FIRST_REPLY", JSON.stringify({ fixturePrompt: fixture.stats.lastPrompt }));
    assert.equal(missionDetail.result, finalResult);
    assert.equal(listedMission.state, missionDetail.state);
    assert.equal(dispatchRecord.status, "completed");
    evidence.productPath = {
      dispatchCreatedBy: "submitMission",
      workflow: "submitMission -> submitMissionDispatch -> writeMissionDispatchRecord -> OpenClaw Gateway -> Workforce projection",
      manualDispatchInjection: false,
      persistedSidecar: true,
      missionListFromPersistedSidecar: true,
      missionDetailFromPersistedSidecar: true,
      requestId,
      dispatchId: productMission.dispatchId,
      agentId: dispatchRecord.agentId,
      workspaceId: dispatchRecord.workspaceId,
      sessionKey: dispatchRecord.result?.sessionKey ?? null,
      runId: dispatchRecord.result?.runId ?? null
    };
    evidence.checks["product-path-mission-create"] = { status: "PASS", evidence: ["APPLICATION_PATH", LIVE_EVIDENCE_CLASS], detail: "Canonical submitMission created and persisted the dispatch; the native Gateway populated runtime identity." };
    evidence.checks["product-path-api-list"] = { status: "PASS", evidence: ["APPLICATION_PATH", LIVE_EVIDENCE_CLASS], detail: "Mission list discovered the persisted dispatch and matched detail state from the same snapshot." };
    evidence.checks["product-path-api-detail"] = { status: "PASS", evidence: ["APPLICATION_PATH", LIVE_EVIDENCE_CLASS], detail: "Mission detail resolved by dispatch id from persisted sidecar plus current native snapshot." };
    evidence.checks["mission-basic"] = { status: "PASS", evidence: ["APPLICATION_PATH", LIVE_EVIDENCE_CLASS], detail: "Real AgentOS submission reached one native session/run and completed with authoritative output." };

    const completionCountBeforeReplay = fixture.stats.completionCount;
    const replayInput = { mission: "WORKFORCE_ACCEPTANCE_FIRST", requestId, agentId: "main", thinking: "off" as const };
    const [replay, concurrentReplay] = await Promise.all([
      submitMission(replayInput, mutationOptions()),
      submitMission(replayInput, mutationOptions())
    ]);
    assert.equal(replay.dispatchId, productMission.dispatchId);
    assert.equal(concurrentReplay.dispatchId, productMission.dispatchId);
    assert.equal(fixture.stats.completionCount, completionCountBeforeReplay);
    await assert.rejects(
      submitMission({ mission: "WORKFORCE_ACCEPTANCE_DIFFERENT", requestId, agentId: "main", thinking: "off" }, mutationOptions()),
      /request identity is already in use/i
    );
    const persistedRecords = await readMissionDispatchRecords();
    assert.equal(persistedRecords.filter((record) => record.clientRequestId === requestId).length, 1);
    evidence.checks["product-path-idempotency"] = { status: "PASS", evidence: ["APPLICATION_PATH", LIVE_EVIDENCE_CLASS], detail: "Concurrent replay returned the same persisted dispatch without another native model completion; altered request identity failed closed." };
    evidence.checks["result-projection"] = { status: "PASS", evidence: ["APPLICATION_PATH", LIVE_EVIDENCE_CLASS], detail: "Final output came from the native Gateway result persisted by the canonical Mission workflow and reconstructed in Mission detail." };

    const admissionBarrier = createConcurrentAdmissionBarrier(2);
    try {
      setOpenClawAdapterForTesting(withConcurrentAdmissionBarrier(getOpenClawAdapter(), admissionBarrier));
      const concurrentRequests = [
        { mission: "WORKFORCE_ACCEPTANCE_CONCURRENT_A", requestId: `workforce-concurrent-a-${Date.now()}`, agentId: "main", thinking: "off" as const },
        { mission: "WORKFORCE_ACCEPTANCE_CONCURRENT_B", requestId: `workforce-concurrent-b-${Date.now()}`, agentId: "main", thinking: "off" as const }
      ];
      const concurrentTasks = await Promise.all(concurrentRequests.map((input) => submitMission(input, mutationOptions())));
      const concurrentRecords = await Promise.all(concurrentTasks.map(async (task) => {
        assert.ok(task.dispatchId);
        const record = await readMissionDispatchRecordById(task.dispatchId);
        assert.ok(record);
        assert.equal(record.admissionState, "accepted");
        assert.ok(record.sessionKey);
        assert.ok(record.sessionId);
        assert.ok(record.result?.runId);
        cleanupRefs.sessionKeys.push(record.sessionKey);
        return record;
      }));
      assert.notEqual(concurrentRecords[0]?.id, concurrentRecords[1]?.id);
      assert.notEqual(concurrentRecords[0]?.sessionKey, concurrentRecords[1]?.sessionKey);
      assert.notEqual(concurrentRecords[0]?.sessionId, concurrentRecords[1]?.sessionId);
      assert.notEqual(concurrentRecords[0]?.result?.runId, concurrentRecords[1]?.result?.runId);
      evidence.concurrentAdmission = {
        unrelatedRequestCount: concurrentRecords.length,
        concurrentAdapterAdmissions: admissionBarrier.arrivalCount,
        sameAgent: concurrentRecords.every((record) => record.agentId === "main"),
        distinctDispatchIds: new Set(concurrentRecords.map((record) => record.id)).size === concurrentRecords.length,
        distinctSessionKeys: new Set(concurrentRecords.map((record) => record.sessionKey)).size === concurrentRecords.length,
        distinctSessionIds: new Set(concurrentRecords.map((record) => record.sessionId)).size === concurrentRecords.length,
        distinctRunIds: new Set(concurrentRecords.map((record) => record.result?.runId)).size === concurrentRecords.length
      };
      evidence.checks["concurrent-task-admission"] = {
        status: "PASS",
        evidence: ["APPLICATION_PATH", "OPENCLAW_NATIVE_GATEWAY", LIVE_EVIDENCE_CLASS],
        detail: "Two different requests reached native admission concurrently for one agent and OpenClaw returned distinct dispatch-correlated session keys, session IDs, and run IDs."
      };
    } finally {
      admissionBarrier.close();
      setOpenClawAdapterForTesting(null);
    }

    const artifactRequestId = `workforce-artifact-${Date.now()}`;
    const artifactMission = await submitMission({
      mission: "WORKFORCE_ACCEPTANCE_ARTIFACT",
      requestId: artifactRequestId,
      agentId: "main",
      thinking: "off"
    }, mutationOptions());
    assert.ok(artifactMission.dispatchId);
    const artifactDispatchId = artifactMission.dispatchId;
    const artifactRecord = await waitForDispatchTerminal(artifactDispatchId, async () => {
      await getMissionControlSnapshot({ force: true });
    });
    const artifactSnapshot = await getMissionControlSnapshot({ force: true });
    const artifactDetail = await getWorkforceMissionDetail(artifactDispatchId, { snapshot: artifactSnapshot });
    assert.ok(artifactDetail);
    assert.equal(artifactRecord.status, "completed");
    assert.equal(resolveMissionDispatchResultText(artifactRecord), "AGENTOS_FIXTURE_ARTIFACT_REPLY", JSON.stringify({ fixturePrompt: fixture.stats.lastPrompt }));
    const artifactPaths = artifactDetail.artifacts.map((artifact) => artifact.path || artifact.displayPath).filter(Boolean);
    evidence.checks.artifacts = artifactPaths.includes("deliverables/acceptance-result.txt")
      ? { status: "PASS", evidence: ["APPLICATION_PATH", LIVE_EVIDENCE_CLASS], detail: "OpenClaw executed the native write tool and Workforce projected the bounded runtime-created artifact." }
      : { status: "SKIPPED", evidence: ["APPLICATION_PATH", LIVE_EVIDENCE_CLASS], detail: "The product-path mission completed, but no bounded runtime-created artifact was exposed by the native task/session projection." };

    const sourceWorkspace = artifactSnapshot.workspaces.find((workspace) => workspace.path === workspaceDir ||
      workspace.id === artifactDetail.workspaceId);
    assert.ok(sourceWorkspace);
    await mkdir(path.join(workspaceDir, "docs"), { recursive: true });
    await writeFile(path.join(workspaceDir, "docs", "studio-data.csv"), "region,count\nnorth,12\nsouth,8\n");
    const hire = await createAgent({
      id: "studio-researcher",
      workspaceId: sourceWorkspace.id,
      name: "Studio Researcher",
      modelId: selectedModel
    }, mutationOptions());
    const researchMission = await submitMission({
      mission: "Read the studio source data, find the combined count, and produce a Markdown brief and CSV summary. WORKFORCE_ACCEPTANCE_RESEARCH",
      expectedOutcome: "A usable Markdown brief and a CSV summary",
      acceptanceCriteria: "Both files cite or reproduce the studio source and give the correct combined count.",
      requestId: `workforce-research-${Date.now()}`,
      workspaceId: sourceWorkspace.id,
      agentId: hire.agentId
    }, mutationOptions());
    assert.ok(researchMission.dispatchId);
    const research = await waitForDispatchTerminal(researchMission.dispatchId, async () => {
      await getMissionControlSnapshot({ force: true });
    });
    assert.ok(research.sessionKey);
    cleanupRefs.sessionKeys.push(research.sessionKey);
    const researchDetail = await getWorkforceMissionDetail(research.id, {
      snapshot: await getMissionControlSnapshot({ force: true })
    });
    assert.equal(research.status, "completed", research.error ?? undefined);
    assert.match(researchDetail?.result ?? "", /combined count is 20/i);
    assert.equal(researchDetail?.deliverable?.artifactCount, 2);
    assert.equal(researchDetail?.expectedOutcome, "A usable Markdown brief and a CSV summary");
    for (const [file, expected] of [["studio-brief.md", "combined count is 20"], ["studio-summary.csv", "total,20"]]) {
      const artifact: WorkforceArtifact | undefined = researchDetail?.artifacts.find((entry) => entry.displayPath === file);
      assert.ok(artifact);
      const download = await downloadWorkforceMissionArtifact(research.id, artifact.id);
      assert.ok(download);
      assert.ok(new TextDecoder().decode(download.bytes).includes(expected));
      assert.equal(await downloadWorkforceMissionArtifact(artifactDispatchId, artifact.id), null);
    }
    evidence.checks["default-employee-research-deliverable"] = { status: "PASS", evidence: ["APPLICATION_PATH", "OPENCLAW_NATIVE_GATEWAY", LIVE_EVIDENCE_CLASS], detail: "A new default employee read a controlled workspace source, calculated its total, and wrote Markdown and CSV. Both downloads contained the correct result and an unrelated mission could not retrieve them." };

    const delegationRequestId = `workforce-delegation-${Date.now()}`;
    const delegationPromise = submitMission({
      mission: "WORKFORCE_ACCEPTANCE_DELEGATION",
      requestId: delegationRequestId,
      agentId: "main",
      thinking: "off"
    }, mutationOptions());
    let observedWaitingWorker = false;
    const delegationObservationDeadline = Date.now() + 27_000;
    while (Date.now() < delegationObservationDeadline) {
      const delegationRecord = (await readMissionDispatchRecords()).find((record) => record.clientRequestId === delegationRequestId);
      if (delegationRecord) {
        const delegationSnapshot = await getMissionControlSnapshot({ force: true });
        const delegationList = await getWorkforceMissionList({ snapshot: delegationSnapshot });
        const delegationDetail = await getWorkforceMissionDetail(delegationRecord.id, { snapshot: delegationSnapshot });
        observedWaitingWorker ||= delegationList.missions.find((mission) => mission.id === delegationRecord.id)?.state === "waiting-worker";
        observedWaitingWorker ||= delegationDetail?.state === "waiting-worker";
        if (observedWaitingWorker || ["stalled", "cancelled"].includes(delegationRecord.status)) break;
      }
      await wait(150);
    }
    const delegationMission = await delegationPromise;
    assert.ok(delegationMission.dispatchId);
    const delegationRecord = await readMissionDispatchRecordById(delegationMission.dispatchId);
    assert.ok(delegationRecord);
    assert.ok(delegationRecord.sessionKey);
    const delegationTaskPayload = await client.listTasks({ sessionKey: delegationRecord.sessionKey }, { timeoutMs: TIMEOUT_MS }).catch(() => undefined);
    const delegationTaskRuntimes = mapOpenClawTaskListToRuntimes(delegationTaskPayload, {
      agentConfig: [{ id: "main", workspace: workspaceDir }],
      agentsList: [{ id: "main", workspace: workspaceDir }],
      resolveWorkspaceId: () => "disposable-workspace"
    });
    const delegationChildRuntimes = delegationTaskRuntimes.filter((runtime) => typeof runtime.metadata.parentTaskId === "string" && runtime.metadata.parentTaskId.length > 0);
    const childDeadline = Date.now() + 15_000;
    let observedNativeChild = false;
    let observedProjectedChild = false;
    let delegationDiagnostic = {};
    while (Date.now() < childDeadline && !observedProjectedChild) {
      const nativeSessions = await client.listSessions({ limit: 100 }, readOptions());
      const child = nativeSessions.sessions.find((entry) =>
        entry.spawnedBy === delegationRecord.sessionKey && entry.status === "done" && typeof entry.key === "string"
      );
      if (child && typeof child.key === "string") {
        observedNativeChild = true;
        cleanupRefs.sessionKeys.push(child.key);
        const current = await getMissionControlSnapshot({ force: true });
        const detail = await getWorkforceMissionDetail(delegationRecord.id, { snapshot: current });
        const item = detail?.workTree.find((work) => work.relationship === "delegated" && work.state === "completed");
        const projected = current.tasks.find((task) => task.id === item?.taskId);
        observedProjectedChild = projected?.metadata.openClawSessionKey === child.key;
        const childTask = current.tasks.find((task) => task.metadata.openClawSessionKey === child.key);
        const rootTask = current.tasks.find((task) => task.id === detail?.rootTaskId);
        delegationDiagnostic = {
          nativeParentMatches: child.parentSessionKey === child.spawnedBy,
          nativeUpdatedAt: typeof child.updatedAt === "number",
          runtimeFound: current.runtimes.some((runtime) => runtime.key === child.key),
          sessionIdFound: current.runtimes.some((runtime) => runtime.sessionId === child.sessionId),
          runtimeCount: current.runtimes.length,
          snapshotMode: current.mode,
          nativeRuntimeTagged: current.runtimes.some((runtime) => runtime.key === child.key && runtime.metadata.nativeDelegatedSession === true),
          childTaskStatus: childTask?.status ?? null,
          childParentMatches: childTask?.metadata.requesterSessionKey === delegationRecord.sessionKey,
          sameWorkspace: Boolean(rootTask && childTask && rootTask.workspaceId === childTask.workspaceId),
          rootSessionMatches: rootTask?.metadata.openClawSessionKey === delegationRecord.sessionKey,
          missionWorkItems: detail?.workTree.map((work) => ({ relationship: work.relationship, state: work.state }))
        };
      }
      if (!observedProjectedChild) await wait(250);
    }
    assert.ok(observedNativeChild, "Native Gateway sessions.list did not expose the expected completed child.");
    if (!observedProjectedChild) {
      const productSessions = await settleSessionsPayloadFromOpenClaw([{ id: "main", workspace: workspaceDir }]);
      delegationDiagnostic = {
        ...delegationDiagnostic,
        productSessionCount: productSessions.status === "fulfilled" ? productSessions.value.sessions.length : null,
        productSessionHasChild: productSessions.status === "fulfilled" && productSessions.value.sessions.some((entry) => entry.spawnedBy === delegationRecord.sessionKey)
      };
    }
    assert.ok(observedProjectedChild, `Workforce did not link the native child: ${JSON.stringify(delegationDiagnostic)}`);
    evidence.checks.delegation = { status: "PASS", evidence: ["APPLICATION_PATH", "OPENCLAW_NATIVE_GATEWAY", LIVE_EVIDENCE_CLASS], detail: "The submitted mission spawned a native child. Workforce linked the completed child using its exact Gateway session and requester keys." };
    evidence.checks["waiting-worker"] = observedWaitingWorker
      ? { status: "PASS", evidence: ["APPLICATION_PATH", LIVE_EVIDENCE_CLASS], detail: "Workforce observed the parent-idle and child-running interval as waiting for a worker." }
      : { status: "SKIPPED", evidence: ["APPLICATION_PATH", LIVE_EVIDENCE_CLASS], detail: "The bounded observation did not capture a stable parent-idle and child-running interval." };

    const nativeTasks = buildTaskRecords(delegationTaskRuntimes, []);
    const nativeChildren = delegationChildRuntimes;
    evidence.runtimeTaskLedger = {
      taskListRead: Boolean(delegationTaskPayload),
      taskCount: nativeTasks.length,
      taskIds: delegationTaskRuntimes.map((runtime) => runtime.taskId).filter(Boolean),
      childCount: nativeChildren.length
    };

    const cancelMission = await submitMission({
      mission: "WORKFORCE_ACCEPTANCE_CANCEL",
      requestId: `workforce-cancel-${Date.now()}`,
      agentId: "main",
      thinking: "off"
    }, mutationOptions());
    assert.ok(cancelMission.dispatchId);
    const cancelRecord = await readMissionDispatchRecordById(cancelMission.dispatchId);
    assert.ok(cancelRecord?.sessionKey);
    cleanupRefs.sessionKeys.push(cancelRecord.sessionKey);
    const cancelSnapshot = await getMissionControlSnapshot({ force: true });
    const cancelTask = cancelSnapshot.tasks.find((task) => task.dispatchId === cancelMission.dispatchId);
    const cancelled = await abortMissionTask(cancelTask?.id ?? cancelMission.dispatchId, "Stop the disposable fixture run.", cancelMission.dispatchId, mutationOptions());
    assert.equal(cancelled.cancellationStatus, "confirmed", cancelled.summary);
    const cancelledDetail = await getWorkforceMissionDetail(cancelMission.dispatchId, {
      snapshot: await getMissionControlSnapshot({ force: true })
    });
    assert.equal(cancelledDetail?.state, "cancelled");
    evidence.checks.cancellation = { status: "PASS", evidence: ["APPLICATION_PATH", "OPENCLAW_NATIVE_GATEWAY", LIVE_EVIDENCE_CLASS], detail: "The normal task control path aborted an exact running native session and projected the confirmed outcome." };

    const failingMission = await submitMission({
      mission: "WORKFORCE_ACCEPTANCE_DELEGATION_FAILURE",
      requestId: `workforce-child-failure-${Date.now()}`,
      agentId: "main",
      thinking: "off"
    }, mutationOptions());
    assert.ok(failingMission.dispatchId);
    const failingRecord = await readMissionDispatchRecordById(failingMission.dispatchId);
    assert.ok(failingRecord?.sessionKey);
    cleanupRefs.sessionKeys.push(failingRecord.sessionKey);
    const failureDeadline = Date.now() + 20_000;
    let observedChildFailure = false;
    while (!observedChildFailure && Date.now() < failureDeadline) {
      const native = await client.listSessions({ limit: 50 }, readOptions());
      const child = native.sessions.find((entry) => entry.spawnedBy === failingRecord.sessionKey);
      if (child?.status === "failed" && typeof child.key === "string") {
        cleanupRefs.sessionKeys.push(child.key);
        const current = await getMissionControlSnapshot({ force: true });
        const mission = await getWorkforceMissionDetail(failingMission.dispatchId, { snapshot: current });
        const failure = mission?.workTree.find((item) => item.relationship === "delegated" && item.state === "failed");
        observedChildFailure = current.tasks.some((task) => task.id === failure?.taskId && task.metadata.openClawSessionKey === child.key);
      }
      if (!observedChildFailure) await wait(250);
    }
    assert.ok(observedChildFailure, "The controlled provider failure did not appear on the native child and Workforce task tree.");
    evidence.checks["child-failure"] = { status: "PASS", evidence: ["APPLICATION_PATH", "OPENCLAW_NATIVE_GATEWAY", LIVE_EVIDENCE_CLASS], detail: "A controlled provider rejection was observed as failure on the native child session and the linked Workforce item." };

    await runHumanControlJourneys(client, evidence, cleanupRefs);
    const missionQuestion = await client.callNative<Record<string, unknown>>("question.request", {
      sessionKey,
      agentId: "main",
      questions: [{ questionId: "mission_decision", header: "Scope", question: "Which fixture scope?", options: [{ label: "Narrow" }, { label: "Broad" }] }],
      timeoutMs: 30_000
    }, mutationOptions());
    const missionQuestionId = readString(missionQuestion.id);
    assert.ok(missionQuestionId);
    cleanupRefs.questionIds.push(missionQuestionId);
    const snapshotWithQuestion = await getMissionControlSnapshot({ force: true });
    const { items } = await getHumanControlInbox({ snapshot: snapshotWithQuestion });
    const projectedQuestion = items.find((item) => item.id === `question:${missionQuestionId}`);
    assert.ok(projectedQuestion?.mission && projectedQuestion.source.taskId);
    assert.equal(projectedQuestion.source.sessionKey, sessionKey);
    assert.equal(projectedQuestion.status, "pending");
    await resolveAttentionItem(projectedQuestion.id, "answer", { answers: { answers: { mission_decision: ["Narrow"] } } });
    const answer = await client.callNative<Record<string, unknown>>("question.waitAnswer", { id: missionQuestionId, timeoutMs: 1_000 }, readOptions());
    assert.equal(answer.status, "answered");
    evidence.checks["human-control-product-path"] = {
      status: "PASS",
      evidence: ["APPLICATION_PATH", LIVE_EVIDENCE_CLASS],
      detail: "A native question tied to the Mission session appeared with task provenance in AgentOS Human Control. Answering through the application service settled that exact native question."
    };

    client.close("workforce acceptance reconnect");
    client = null;
    await stopDisposableProcess(gateway);
    gateway = await startGateway({ packageRoot, stateDir, workspaceDir, configPath, port, token });
    client = createClient(port, token, "0.1.0-agentos-workforce-acceptance-reconnect", stateDir);
    setOpenClawGatewayClientForTesting(client);
    setOpenClawAdapterForTesting(null);
    clearMissionControlCaches();
    const sessionsAfterRestart = await client.listSessions({ search: sessionKey }, { timeoutMs: TIMEOUT_MS });
    const recovered = sessionsAfterRestart.sessions.filter((entry) => entry.key === sessionKey);
    assert.equal(recovered.length, 1);
    const postRestartHistory = await readHistory(client, sessionKey, 1);
    assert.ok(postRestartHistory.some((message) => message.includes("AGENTOS_FIXTURE_FIRST_REPLY")));
    evidence.checks["gateway-reconnect"] = { status: "PASS", evidence: ["APPLICATION_PATH", LIVE_EVIDENCE_CLASS], detail: "The product-path Mission retained the same exact session key and history across disposable Gateway restart." };
    const rebuiltSnapshot = await getMissionControlSnapshot({ force: true });
    const rebuiltDetail = await getWorkforceMissionDetail(productMission.dispatchId, { snapshot: rebuiltSnapshot });
    assert.equal(rebuiltDetail?.state, "completed");
    assert.equal(rebuiltDetail?.result, finalResult);
    evidence.checks["agentos-restart-projection"] = { status: "PASS", evidence: ["APPLICATION_PATH", LIVE_EVIDENCE_CLASS], detail: "Workforce projection rebuilt from the persisted product-path dispatch and native session after Gateway restart." };

  } catch (error) {
    evidence.failure = sanitizeText(error instanceof Error ? error.message : "Workforce acceptance failed.");
    throw error;
  } finally {
    if (client && cleanupRefs.approvalId) await client.callNative("exec.approval.resolve", { id: cleanupRefs.approvalId, decision: "deny" }, mutationOptions()).catch(() => {});
    if (client) {
      for (const id of cleanupRefs.questionIds) await client.callNative("question.resolve", { id, cancel: true }, mutationOptions()).catch(() => {});
      for (const key of new Set([sessionKey, ...cleanupRefs.sessionKeys].filter((value): value is string => Boolean(value)))) {
        await client.callNative("sessions.delete", { key, deleteTranscript: true }, mutationOptions()).catch(() => {});
      }
      client.close("workforce acceptance cleanup");
    }
    setOpenClawAdapterForTesting(null);
    resetOpenClawGatewayClient("workforce acceptance cleanup");
    restoreEnvironment(parentEnvironment);
    await stopDisposableProcess(gateway).catch(() => {});
    await fixture.close().catch(() => {});
    await rm(disposableRoot, { recursive: true, force: true }).catch(() => {});
    evidence.cleanup = { disposableRootRemoved: !(await pathExists(disposableRoot)), gatewayStopped: isDisposableProcessStopped(gateway), productionGatewayTouched: false };
    for (const checkId of REQUIRED_WORKFORCE_PRODUCT_CHECKS) {
      if (evidence.checks[checkId]?.status !== "PASS") {
        evidence.checks[checkId] = {
          status: "FAIL",
          evidence: ["APPLICATION_PATH", LIVE_EVIDENCE_CLASS],
          detail: "A required disposable AgentOS product-path check did not complete successfully."
        };
      }
    }
    const upstreamGapChecks = ["artifacts", "delegation", "waiting-worker", "cancellation", "child-failure", "human-control-product-path"]
      .filter((id) => evidence.checks[id]?.status === "SKIPPED");
    evidence.summary = summarizeChecks(evidence.checks);
    evidence.certification = {
      status: evidence.summary.failed > 0
        ? "INCOMPLETE"
        : upstreamGapChecks.length > 0
          ? "PRODUCT_PATH_CERTIFIED_WITH_UPSTREAM_TASK_GAPS"
          : "FULLY_CERTIFIED",
      capabilityRoutingReady: evidence.summary.failed === 0 && upstreamGapChecks.length === 0,
      skippedLiveChecks: upstreamGapChecks
    };
    await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
    await writeFile(OUTPUT_PATH, `${JSON.stringify(sanitizeEvidence(evidence), null, 2)}\n`, { mode: 0o600 });
  }

  if (evidence.summary.failed > 0) throw new Error(`Workforce acceptance failed. Evidence: ${OUTPUT_PATH}`);
  console.log(`OPENCLAW ${OPENCLAW_IDENTITY_CONTRACT_VERSION} WORKFORCE ACCEPTANCE: PASS`);
  console.log(`Evidence: ${OUTPUT_PATH}`);
}

async function readFixtureModelState(client: GatewayClient, modelId: string) {
  const deadline = Date.now() + 20_000;
  for (;;) {
    try {
      const result = await Promise.all([
        client.listModels({ view: "configured", all: true, agentId: "main" }, { timeoutMs: TIMEOUT_MS }),
        client.getAgentModelStatus({ agentId: "main" }, { timeoutMs: TIMEOUT_MS })
      ]);
      if (resolveModelReadiness(result[0].models, result[1], [modelId]).ready || Date.now() >= deadline) {
        return result;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/metadata is starting|startup inspection|startup preparation/i.test(message) || Date.now() >= deadline) {
        throw error;
      }
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 500));
  }
}

async function runHumanControlJourneys(client: GatewayClient, evidence: ReturnType<typeof createEvidence>, cleanupRefs: { questionIds: string[]; approvalId: string | null }) {
  const questionPayloads = await Promise.all([["workforce_one", "Scope one"], ["workforce_two", "Scope two"]].map(([id, header]) => client.callNative<Record<string, unknown>>("question.request", {
    questions: [{ questionId: id, header, question: "Which safe disposable scope?", options: [{ label: "Narrow" }, { label: "Broad" }] }]
  }, mutationOptions())));
  const questionIds = questionPayloads.map((payload) => readString(payload.id)).filter((id): id is string => Boolean(id));
  assert.equal(questionIds.length, 2);
  cleanupRefs.questionIds = questionIds;
  const pending = await client.callNative<{ questions: Array<Record<string, unknown>> }>("question.list", {}, readOptions());
  assert.equal(pending.questions.filter((question) => questionIds.includes(readString(question.id) ?? "") && question.status === "pending").length, 2);
  const projection = projectQuestionRecords(pending.questions.filter((question) => questionIds.includes(readString(question.id) ?? "")) as never, [], []);
  assert.equal(projection.length, 2);
  await client.callNative("question.resolve", { id: questionIds[0], answers: { answers: { workforce_one: ["Narrow"] } } }, mutationOptions());
  const oneRemaining = await client.callNative<{ questions: Array<Record<string, unknown>> }>("question.list", {}, readOptions());
  assert.equal(oneRemaining.questions.filter((question) => questionIds.includes(readString(question.id) ?? "") && question.status === "pending").length, 1);
  await client.callNative("question.resolve", { id: questionIds[1], answers: { answers: { workforce_two: ["Narrow"] } } }, mutationOptions());
  evidence.checks["multiple-human-control"] = { status: "PASS", evidence: LIVE_EVIDENCE_CLASS, detail: "Two native questions remained independently pending until both were resolved." };

  const createdApproval = await client.callNative<Record<string, unknown>>("exec.approval.request", {
    command: "echo AGENTOS_WORKFORCE_SAFE_APPROVAL",
    agentId: "main",
    ask: "always",
    twoPhase: true,
    requireDeliveryRoute: false,
    suppressDelivery: true
  }, mutationOptions());
  const approvalId = readString(createdApproval.id);
  assert.ok(approvalId);
  cleanupRefs.approvalId = approvalId;
  const approvalList = await client.callNative<unknown[]>("exec.approval.list", {}, readOptions());
  assert.ok(approvalList.some((entry) => asRecord(entry)?.id === approvalId));
  assert.equal(projectApprovalRecords(approvalList as never, "exec", [], []).length, 1);
  await client.callNative("exec.approval.resolve", { id: approvalId, decision: "deny" }, mutationOptions());
  const resolvedApprovals = await client.callNative<unknown[]>("exec.approval.list", {}, readOptions());
  assert.equal(resolvedApprovals.some((entry) => asRecord(entry)?.id === approvalId), false);
  evidence.checks["approval-resolution"] = { status: "PASS", evidence: LIVE_EVIDENCE_CLASS, detail: "Native approval was projected, denied safely, and disappeared from the pending inventory." };
}

function createEvidence(identity: { version: string; sourceCommit: string; buildId: string; packageHash: string }, agentosCommit: string) {
  return {
    schemaVersion: 1,
    artifactType: "openclaw-workforce-acceptance",
    generatedAt: new Date().toISOString(),
    provenance: { repository: "SapienXai/AgentOS", agentosCommit, openClaw: identity, evidenceClasses: [LIVE_EVIDENCE_CLASS, "DETERMINISTIC_NATIVE_FIXTURE"] },
    runtime: null as Record<string, unknown> | null,
    modelAuthSetup: null as Record<string, unknown> | null,
    modelReadiness: null as Record<string, unknown> | null,
    productPath: null as Record<string, unknown> | null,
    concurrentAdmission: null as Record<string, unknown> | null,
    reconciliationDiagnostic: null as Record<string, unknown> | null,
    checks: {} as Record<string, { status: CheckStatus; evidence: string | string[]; detail?: string }>,
    runtimeTaskLedger: null as Record<string, unknown> | null,
    cleanup: null as Record<string, unknown> | null,
    certification: null as Record<string, unknown> | null,
    failure: null as string | null,
    summary: { passed: 0, skipped: 0, failed: 0 }
  };
}

async function readHistory(client: GatewayClient, sessionKey: string, minimum: number) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const payload = await client.callNative<{ messages?: unknown[] }>("chat.history", { sessionKey, limit: 50 }, readOptions());
    const messages = (payload.messages ?? []).flatMap((entry) => {
      const record = asRecord(entry);
      if (record?.role !== "assistant") return [];
      if (typeof record.content === "string") return [record.content];
      if (Array.isArray(record.content)) return [record.content.map((part) => asRecord(part)?.text ?? "").join("")];
      return [];
    }).filter(Boolean);
    if (messages.length >= minimum) return messages;
    await wait(250);
  }
  return [];
}

async function readHistoryLifecycleEvidence(
  client: GatewayClient,
  sessionKey: string,
  dispatchRecord: MissionDispatchRecord | null
) {
  const payload = await client.callNative<{ messages?: unknown[] }>("chat.history", { sessionKey, limit: 50 }, readOptions());
  const assistantMessages = (payload.messages ?? []).flatMap((entry) => {
    const record = asRecord(entry);
    const message = asRecord(record?.message) ?? record;
    return message?.role === "assistant" ? [message] : [];
  });
  const expectedReply = assistantMessages.find((message) => {
    if (typeof message.content === "string") return message.content.includes("AGENTOS_FIXTURE_FIRST_REPLY");
    return Array.isArray(message.content) && message.content.some((part) =>
      (typeof asRecord(part)?.text === "string" ? asRecord(part)?.text as string : "").includes("AGENTOS_FIXTURE_FIRST_REPLY")
    );
  });
  const latestAssistant = assistantMessages.at(-1);
  const stopReason = (message: Record<string, unknown> | undefined) => {
    const value = typeof message?.stopReason === "string" ? message.stopReason : "";
    if (!value) return "missing";
    if (value === "stop" || value === "length" || value === "toolUse" || value === "error" || value === "aborted") return value;
    return "other";
  };

  const parsedOutput = dispatchRecord
    ? parseRuntimeOutputFromSessionHistory({
        id: `runtime:${dispatchRecord.sessionId ?? "unknown"}:${dispatchRecord.result?.runId ?? "unknown"}`,
        source: "turn",
        key: sessionKey,
        title: "Acceptance diagnostic",
        subtitle: "Acceptance diagnostic",
        status: "running",
        updatedAt: Date.now(),
        ageMs: 0,
        agentId: dispatchRecord.agentId,
        sessionId: dispatchRecord.sessionId ?? undefined,
        runId: dispatchRecord.result?.runId ?? undefined,
        metadata: {
          mission: dispatchRecord.mission,
          routedMission: dispatchRecord.routedMission,
          dispatchSubmittedAt: dispatchRecord.submittedAt,
          sessionKey
        }
      }, payload, dispatchRecord.workspacePath ?? undefined)
    : null;

  return {
    assistantMessageCount: assistantMessages.length,
    expectedReplyHasStopReason: Boolean(expectedReply && stopReason(expectedReply) !== "missing"),
    expectedReplyStopReason: stopReason(expectedReply),
    latestAssistantHasStopReason: Boolean(latestAssistant && stopReason(latestAssistant) !== "missing"),
    latestAssistantStopReason: stopReason(latestAssistant),
    parsedOutput: parsedOutput
      ? {
          status: parsedOutput.status,
          hasFinalTimestamp: Boolean(parsedOutput.finalTimestamp),
          stopReason: parsedOutput.stopReason,
          hasError: Boolean(parsedOutput.errorMessage),
          itemCount: parsedOutput.items.length,
          hasFinalText: Boolean(parsedOutput.finalText?.trim())
        }
      : null
  };
}

async function waitForDispatchTerminal(
  dispatchId: string,
  refreshProjection: () => Promise<void>,
  timeoutMs = 30_000
): Promise<MissionDispatchRecord> {
  const deadline = Date.now() + timeoutMs;
  let record: MissionDispatchRecord | null = null;

  while (Date.now() < deadline) {
    record = await readMissionDispatchRecordById(dispatchId);
    if (record && ["completed", "stalled", "cancelled"].includes(record.status)) {
      return record;
    }
    await refreshProjection();
    await wait(250);
  }

  throw new Error(`Mission dispatch ${dispatchId} did not reach a terminal state before the acceptance timeout.`);
}

async function startGateway(input: { packageRoot: string; stateDir: string; workspaceDir: string; configPath: string; port: number; token: string }) {
  const homeDir = path.join(path.dirname(input.stateDir), "home");
  await mkdir(homeDir, { recursive: true, mode: 0o700 });
  const child = spawn(process.execPath, [path.join(input.packageRoot, "openclaw.mjs"), "gateway", "run", "--port", String(input.port), "--bind", "loopback", "--allow-unconfigured", "--auth", "token", "--token", input.token, "--ws-log", "compact"], { cwd: input.workspaceDir, env: createDisposableOpenClawEnvironment({ homeDir, overrides: { OPENCLAW_STATE_DIR: input.stateDir, OPENCLAW_CONFIG_PATH: input.configPath, OPENCLAW_GATEWAY_TOKEN: input.token, OPENAI_API_KEY: "sk-agentos-workforce-fixture-00000000" } }), stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout?.on("data", (chunk: Buffer | string) => { output = `${output}${chunk.toString()}`.slice(-8_000); });
  child.stderr?.on("data", (chunk: Buffer | string) => { output = `${output}${chunk.toString()}`.slice(-8_000); });
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (isDisposableProcessStopped(child)) throw new Error(`Disposable Gateway exited (${child.exitCode}). ${sanitizeText(output)}`);
    try { if ((await fetch(`http://127.0.0.1:${input.port}/healthz`)).ok) return child; } catch {}
    await wait(250);
  }
  await stopDisposableProcess(child);
  throw new Error(`Disposable Gateway did not become ready. ${sanitizeText(output)}`);
}

async function writeConfig(configPath: string, workspaceDir: string, fixtureBaseUrl: string, fixtureModelId: string, token: string) {
  await writeFile(configPath, `${JSON.stringify({ gateway: { mode: "local", bind: "loopback", auth: { mode: "token", token } }, tools: { sessions: { visibility: "tree" }, agentToAgent: { enabled: false, allow: [] } }, agents: { defaults: { workspace: workspaceDir, model: { primary: `openai/${fixtureModelId}` } }, entries: { main: { workspace: workspaceDir } } }, models: { mode: "merge", providers: { openai: { baseUrl: fixtureBaseUrl, api: "openai-completions", apiKey: { source: "env", provider: "default", id: "OPENAI_API_KEY" }, timeoutSeconds: 30, models: [{ id: fixtureModelId, name: "AgentOS Workforce Fixture", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32_768, maxTokens: 128 }] } } }, cron: { enabled: false } }, null, 2)}\n`, { mode: 0o600 });
}

function createClient(port: number, token: string, clientVersion: string, stateDir: string) { return createOfficialBackedOpenClawGatewayClient({ url: `ws://127.0.0.1:${port}`, token, role: "operator", scopes: ["operator.admin", "operator.read", "operator.write", "operator.approvals", "operator.questions"], timeoutMs: TIMEOUT_MS, clientName: "gateway-client", clientVersion, stateDir, ensureDeviceIdentity: true, includeDeviceIdentityWithExplicitAuth: true, sharedStateMode: "read-only" }); }
function mutationOptions() { return { timeoutMs: TIMEOUT_MS, safety: "mutation" as const }; }
function createConcurrentAdmissionBarrier(expected: number) {
  let arrivals = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let resolveGate!: () => void;
  let rejectGate!: (error: Error) => void;
  const gate = new Promise<void>((resolve, reject) => { resolveGate = resolve; rejectGate = reject; });
  timer = setTimeout(() => rejectGate(new Error(`Concurrent admission barrier timed out after ${arrivals}/${expected} arrivals.`)), TIMEOUT_MS);
  return {
    async wait() {
      arrivals += 1;
      if (arrivals >= expected) {
        if (timer) clearTimeout(timer);
        resolveGate();
      }
      await gate;
    },
    get arrivalCount() {
      return arrivals;
    },
    close() {
      if (timer) clearTimeout(timer);
      resolveGate();
    },
  };
}
function withConcurrentAdmissionBarrier(adapter: OpenClawAdapter, barrier: ReturnType<typeof createConcurrentAdmissionBarrier>): OpenClawAdapter {
  return new Proxy(adapter, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (property === "runAgentTurn" && typeof value === "function") {
        return async (...args: Parameters<OpenClawAdapter["runAgentTurn"]>) => {
          if (args[0].message.includes("WORKFORCE_ACCEPTANCE_CONCURRENT_")) await barrier.wait();
          return value.apply(target, args);
        };
      }
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
function readOptions() { return { timeoutMs: TIMEOUT_MS, safety: "read" as const }; }
function summarizeChecks(checks: Record<string, { status: CheckStatus }>) { return Object.values(checks).reduce((summary, check) => { if (check.status === "PASS") summary.passed += 1; else if (check.status === "FAIL") summary.failed += 1; else summary.skipped += 1; return summary; }, { passed: 0, skipped: 0, failed: 0 }); }
async function readPackageIdentity(packageRoot: string) { const pkg = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8")) as { version?: string }; const buildInfo = JSON.parse(await readFile(path.join(packageRoot, "dist", "build-info.json"), "utf8")) as { commit?: string; buildId?: string }; const hash = createHash("sha256"); for (const file of ["package.json", "openclaw.mjs", "dist/build-info.json"]) { hash.update(file); hash.update(await readFile(path.join(packageRoot, file))); } return { version: pkg.version ?? "", sourceCommit: buildInfo.commit ?? "", buildId: buildInfo.buildId ?? "", packageHash: hash.digest("hex") }; }
async function reservePort() { return await new Promise<number>((resolve, reject) => { const server = net.createServer(); server.once("error", reject); server.listen(0, "127.0.0.1", () => { const address = server.address(); const port = typeof address === "object" && address ? address.port : 0; server.close((error) => error ? reject(error) : resolve(port)); }); }); }
async function pathExists(candidate: string) { try { await readFile(candidate); return true; } catch { return false; } }
async function readGitHead() { return (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: process.cwd() })).stdout.trim(); }
function asRecord(value: unknown): Record<string, unknown> | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function readString(value: unknown) { return typeof value === "string" && value.trim() ? value.trim() : null; }
function captureEnvironment(names: string[]) {
  return Object.fromEntries(names.map((name) => [name, process.env[name]]));
}
function restoreEnvironment(values: Record<string, string | undefined>) {
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}
function wait(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function sanitizeText(value: string) { return value.replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED_TOKEN]").replace(/agentos-workforce-[A-Za-z0-9._-]+/g, "[REDACTED_TOKEN]").replace(/\/Users\/[^\s"']+/g, "[LOCAL_PATH]").replace(/\/tmp\/[^\s"']+/g, "[DISPOSABLE_PATH]").slice(0, 320); }
function sanitizeEvidence(value: unknown): unknown { if (typeof value === "string") return sanitizeText(value); if (Array.isArray(value)) return value.map(sanitizeEvidence); if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, sanitizeEvidence(nested)])); return value; }

main().catch((error) => { console.error(error instanceof Error ? error.message : "OpenClaw Workforce acceptance failed."); process.exitCode = 1; });

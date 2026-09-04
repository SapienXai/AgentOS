import assert from "node:assert/strict";
import { test } from "node:test";

import {
  dedupeAttentionItems,
  getHumanControlInbox,
  projectApprovalRecord,
  projectCapabilityAttention,
  projectQuestionRecord,
  projectSuggestedWork,
  projectRuntimeIssue,
  resolveAttentionItem,
  sortAttentionItems
} from "@/lib/openclaw/application/human-control-inbox-service";
import type { AttentionItem, MissionControlSnapshot } from "@/lib/openclaw/types";
import { OPENCLAW_GATEWAY_COMPATIBILITY_OPERATIONS } from "@/lib/openclaw/client/gateway-compatibility";

const agent = { id: "worker-1", name: "Backend Engineer" } as never;
const task = {
  id: "task-1",
  key: "agent:worker-1:main",
  title: "Fix authentication",
  mission: "Fix authentication regression",
  subtitle: "Active work",
  status: "stalled",
  updatedAt: 1_700_000_000_000,
  sessionIds: ["session-1"],
  runtimeIds: [],
  runIds: [],
  agentIds: ["worker-1"],
  runtimeCount: 0,
  updateCount: 0,
  liveRunCount: 0,
  artifactCount: 0,
  warningCount: 0,
  metadata: {}
} as never;

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    generatedAt: new Date().toISOString(),
    agents: [agent],
    tasks: [],
    diagnostics: { runtimeIssues: [] },
    nativeWork: { suggestions: [] },
    ...overrides
  } as unknown as MissionControlSnapshot;
}

test("projects native approvals and questions into stable attention items", () => {
  const approval = projectApprovalRecord({
    id: "approval-1",
    request: {
      agentId: "worker-1",
      sessionKey: "session-1",
      commandPreview: "deploy production",
      allowedDecisions: ["allow-once", "deny"]
    }
  }, "exec", [agent], [task]);
  assert.equal(approval?.id, "approval:exec:approval-1");
  assert.equal(approval?.worker.label, "Backend Engineer");
  assert.deepEqual(approval?.availableActions.map((action) => action.id), ["deny", "approve"]);

  const question = projectQuestionRecord({
    id: "question-1",
    questions: [{ questionId: "market", header: "Market", question: "Which market?", options: [{ label: "US" }, { label: "EU" }] }],
    agentId: "worker-1",
    sessionKey: "session-1",
    createdAtMs: 1_700_000_000_000,
    expiresAtMs: 1_700_000_100_000,
    status: "pending"
  }, [agent], [task]);
  assert.equal(question?.id, "question:question-1");
  assert.deepEqual(question?.question?.[0]?.options, [{ label: "US" }, { label: "EU" }]);
  assert.equal(question?.availableActions[0]?.id, "answer");
});

test("composes suggested work and only promotes actionable capability blockers", () => {
  const suggestion = projectSuggestedWork(snapshot({
    nativeWork: {
      suggestions: [{ id: "suggestion-1", title: "Review database integrity", summary: "Review", sourceAgentId: "worker-1", sourceSessionKey: "session-1", createdAt: 1_700_000_000_000 }]
    }
  }));
  assert.equal(suggestion[0]?.id, "suggestion:suggestion-1");
  assert.deepEqual(suggestion[0]?.availableActions.map((action) => action.id), ["review", "accept", "dismiss"]);

  const capability = projectCapabilityAttention([{
    workerId: "worker-1",
    workerLabel: "Backend Engineer",
    sessionKey: "session-1",
    capability: {
      id: "openclaw:gmail",
      label: "Gmail",
      category: "Communication",
      status: "needs-setup",
      configured: true,
      effective: true,
      explanation: "No usable Gmail account is connected.",
      reasons: [{ code: "account_not_connected", message: "No account" }],
      evidence: {},
      remediation: "Connect a Gmail account"
    }
  } as never]);
  assert.equal(capability[0]?.id, "needs-setup:worker-1:openclaw:gmail:account_not_connected");
  assert.equal(capability[0]?.availableActions[0]?.id, "open-setup");
});

test("deduplicates a matching blocker behind native approval and keeps unrelated blockers", () => {
  const approval = projectApprovalRecord({ id: "approval-1", request: { sessionKey: "session-1", toolName: "shell" } }, "exec");
  const blocked = projectCapabilityAttention([{
    workerId: "worker-1",
    sessionKey: "session-1",
    capability: { id: "openclaw:shell", label: "Shell", category: "Development", status: "blocked", configured: true, effective: false, explanation: "Shell is blocked.", reasons: [{ code: "policy_denied", message: "Denied" }], evidence: { tool: { id: "shell" } } }
  } as never])[0];
  const unrelated = projectCapabilityAttention([{
    workerId: "worker-1",
    sessionKey: "session-1",
    capability: { id: "openclaw:files", label: "Files", category: "Files & Data", status: "blocked", configured: true, effective: false, explanation: "Files are blocked.", reasons: [{ code: "policy_denied", message: "Denied" }], evidence: { tool: { id: "files" } } }
  } as never])[0];
  const result = dedupeAttentionItems([approval!, blocked!, unrelated!]);
  assert.equal(result.some((item) => item.id === blocked?.id), false);
  assert.equal(result.some((item) => item.id === unrelated?.id), true);
});

test("sorts by deterministic severity and oldest blocking time", () => {
  const items = [
    { id: "new-high", type: "runtime-issue", severity: "high", createdAt: "2026-01-02T00:00:00.000Z" },
    { id: "old-critical", type: "approval", severity: "critical", createdAt: "2026-01-03T00:00:00.000Z" },
    { id: "old-high", type: "question", severity: "high", createdAt: "2026-01-01T00:00:00.000Z" }
  ].map((item) => ({ ...item, source: { system: "openclaw", kind: item.type }, worker: { id: null, label: null }, title: item.id, summary: item.id, updatedAt: item.createdAt, availableActions: [], status: "pending" })) as AttentionItem[];
  assert.deepEqual(sortAttentionItems(items).map((item) => item.id), ["old-critical", "old-high", "new-high"]);
});

test("inbox reads native attention families in parallel without per-item calls", async () => {
  const calls: string[] = [];
  const inbox = await getHumanControlInbox({
    snapshot: snapshot(),
    adapter: {
      listNativeExecApprovals: async () => { calls.push("exec.approval.list"); return { approvals: [] }; },
      listNativePluginApprovals: async () => { calls.push("plugin.approval.list"); return {}; },
      listQuestions: async () => { calls.push("question.list"); return { questions: [] }; }
    } as never
  });
  assert.deepEqual(calls.sort(), ["exec.approval.list", "plugin.approval.list", "question.list"]);
  assert.equal(inbox.summary.totalPending, 0);
});

test("ambiguous native approval resolution reconciles without a blind retry", async () => {
  let listCalls = 0;
  let resolveCalls = 0;
  const result = await resolveAttentionItem("approval:exec:approval-1", "approve", {}, {
    listNativeExecApprovals: async () => {
      listCalls += 1;
      return listCalls === 1 ? { approvals: [{ id: "approval-1", request: {} }] } : { approvals: [] };
    },
    resolveNativeExecApproval: async () => {
      resolveCalls += 1;
      throw new Error("Gateway request timed out after send");
    }
  } as never);
  assert.deepEqual(result, { reconciled: true, status: "resolved" });
  assert.equal(resolveCalls, 1);
  assert.equal(listCalls, 2);
});

test("runtime failures are projected only when the existing runtime model marks them actionable", () => {
  const item = projectRuntimeIssue({
    id: "runtime-1",
    type: "gateway_unreachable",
    source: "openclaw_gateway",
    severity: "action_required",
    title: "Gateway unavailable",
    message: "The runtime needs inspection.",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    status: "open"
  });
  assert.equal(item.type, "runtime-issue");
  assert.deepEqual(item.availableActions.map((action) => action.id), ["inspect"]);
});

test("Human Control integrates only native reads and resolutions", () => {
  const integrated = new Map(OPENCLAW_GATEWAY_COMPATIBILITY_OPERATIONS.map((operation) => [operation.id, operation]));
  assert.deepEqual(integrated.get("execApprovals")?.productIntegratedMethods, ["exec.approval.list", "exec.approval.resolve"]);
  assert.deepEqual(integrated.get("pluginApprovals")?.productIntegratedMethods, ["plugin.approval.list", "plugin.approval.resolve"]);
  assert.deepEqual(integrated.get("questions")?.productIntegratedMethods, ["question.list", "question.resolve"]);
  assert.equal(integrated.get("execApprovals")?.fallbackAllowed, false);
  assert.equal(integrated.get("pluginApprovals")?.fallbackAllowed, false);
  assert.equal(integrated.get("questions")?.fallbackAllowed, false);
});

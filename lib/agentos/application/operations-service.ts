import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { resolveAccountAccessDecision } from "@/lib/agentos/application/account-access-policy-service";
import type { OperationAction, OperationAuditEntry, OperationJob, OperationJobInput, OperationResult, OperationRun, OperationsSnapshot } from "@/lib/agentos/operations/types";
import { extractAgentChatMessagesFromSessionHistory } from "@/lib/openclaw/agent-chat-response";
import { getOpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import { getOpenClawCapabilityMatrix } from "@/lib/openclaw/application/capability-matrix-service";
import { missionControlRootPath } from "@/lib/openclaw/state/paths";

type Registry = { version: 1; jobs: Record<string, { workspaceId: string; safety: NonNullable<OperationJob["safety"]> }>; audit: OperationAuditEntry[] };
const registryPath = path.join(missionControlRootPath, "operations", "registry.json");
const operationOutputCache = new Map<string, { value: Pick<OperationJob, "latestOutput" | "recentResults" | "sessionKey" | "sessionId">; expiresAt: number }>();
const operationOutputCacheTtlMs = 5 * 60_000;

export async function getOperationsSnapshot(): Promise<OperationsSnapshot> {
  const [registry, matrix] = await Promise.all([readRegistry(), getOpenClawCapabilityMatrix().catch(() => null)]);
  const cronRead = matrix?.cronRead ?? "unknown";
  const cronWrite = matrix?.operations?.cronWrite?.mode === "gateway-native";
  const runHistory = matrix?.operations?.cronRunHistory?.mode === "gateway-native";
  if (cronRead === "unsupported") {
    return unavailableSnapshot(registry.audit, "OpenClaw Gateway did not advertise cron.read. Operations stays read-only until the capability is available.");
  }
  try {
    const adapter = getOpenClawAdapter();
    const [status, payload] = await Promise.all([adapter.getCronStatus(), adapter.listCronJobs({ includeDisabled: true })]);
    const rawJobs = Array.isArray(payload.jobs) ? payload.jobs : [];
    const jobs = rawJobs.map((value) => normalizeOpenClawOperationJob(value, registry.jobs, cronWrite, runHistory));
    const runs = runHistory
      ? (await Promise.all(jobs.map(async (job) => normalizeOpenClawOperationRuns(await adapter.call<unknown>("cron.runs", { jobId: job.id, limit: 50 }), job.id)))).flat()
      : [];
    const reconciledJobs = jobs.map((job) => reconcileJobWithRuns(job, runs.filter((run) => run.jobId === job.id)));
    const hydratedJobs = await Promise.all(reconciledJobs.map((job) => hydrateCompletedOperationOutput(job, adapter)));
    return {
      generatedAt: new Date().toISOString(), source: "openclaw.cron",
      scheduler: { enabled: typeof status.enabled === "boolean" ? status.enabled : null, nextWakeAt: iso(status.nextWakeAtMs), state: "available" },
      jobs: hydratedJobs, runs, audit: registry.audit,
      notices: [
        ...(cronRead === "unknown" ? [{ severity: "warning" as const, title: "Cron capability unverified", detail: "Showing the live OpenClaw cron projection while Gateway capability discovery is unavailable." }] : []),
        ...(runHistory ? [] : [{ severity: "warning" as const, title: "Run history unavailable", detail: "The connected Gateway does not advertise native cron.runs." }])
      ]
    };
  } catch (error) {
    return unavailableSnapshot(registry.audit, error instanceof Error ? error.message : "Unable to read OpenClaw cron state.");
  }
}

export async function createOperation(input: OperationJobInput) {
  const requestId = randomUUID();
  try {
    await requireMutationCapability();
    const { getMissionControlSnapshot } = await import("@/lib/openclaw/application/mission-control-service");
    const snapshot = await getMissionControlSnapshot({ force: true });
    const agent = snapshot.agents.find((entry) => entry.id === input.agentId);
    if (!agent || agent.workspaceId !== input.workspaceId) throw new Error("Owner agent must belong to the selected workspace.");
    const safety = normalizeSafety(input.safety);
    await assertSafety(input.agentId, input.workspaceId, safety);
    const payload = await getOpenClawAdapter().call<Record<string, unknown>>("cron.add", buildOpenClawCronAddParams(input));
    const jobId = string(payload.jobId) ?? string(payload.id);
    if (!jobId) throw new Error("OpenClaw did not return a cron job id.");
    const registry = await readRegistry();
    registry.jobs[jobId] = { workspaceId: input.workspaceId, safety };
    registry.audit.unshift(audit("create", jobId, "accepted", "OpenClaw cron job created.", requestId));
    await writeRegistry(registry);
    return { ok: true, jobId, requestId };
  } catch (error) { await appendAudit(audit("create", null, "failed", message(error), requestId)); throw error; }
}

export async function operateOperation(action: Exclude<OperationAction, "create" | "update">, jobId: string) {
  const requestId = randomUUID();
  try {
    await requireMutationCapability();
    const registry = await readRegistry();
    const metadata = registry.jobs[jobId];
    if (metadata) await assertSafetyForManualRun(action, metadata.safety, jobId);
    if (action === "cancel") throw new Error("OpenClaw does not advertise a documented cron run-cancel operation. The job was not changed.");
    const call: [string, Record<string, unknown>] = action === "run" || action === "retry" ? ["cron.run", { jobId, mode: "force" }]
      : ["cron.update", { jobId, patch: { enabled: action === "resume" } }];
    await getOpenClawAdapter().call<unknown>(call[0], call[1]);
    registry.audit.unshift(audit(action, jobId, "accepted", `OpenClaw ${call[0]} accepted.`, requestId));
    await writeRegistry(registry);
    return { ok: true, requestId };
  } catch (error) { await appendAudit(audit(action, jobId, "failed", message(error), requestId)); throw error; }
}

export async function updateOperationSchedule(input: { jobId: string; trigger: OperationJobInput["trigger"] }) {
  const requestId = randomUUID();
  try {
    await requireMutationCapability();
    const schedule = input.trigger.kind === "at" ? { kind: "at", at: input.trigger.at }
      : input.trigger.kind === "every" ? { kind: "every", everyMs: input.trigger.everyMs }
      : { kind: "cron", expr: input.trigger.expression, ...(input.trigger.timezone ? { tz: input.trigger.timezone } : {}) };
    await getOpenClawAdapter().call<unknown>("cron.update", { jobId: input.jobId, patch: { schedule } });
    const registry = await readRegistry();
    registry.audit.unshift(audit("update", input.jobId, "accepted", "OpenClaw cron schedule updated.", requestId));
    await writeRegistry(registry);
    return { ok: true, requestId };
  } catch (error) { await appendAudit(audit("update", input.jobId, "failed", message(error), requestId)); throw error; }
}

async function requireMutationCapability() {
  const matrix = await getOpenClawCapabilityMatrix({ force: true });
  if (matrix.operations?.cronWrite?.mode !== "gateway-native") throw new Error("OpenClaw Gateway does not advertise native cron mutations; AgentOS will not use an unverified scheduler fallback.");
}

async function assertSafety(agentId: string, workspaceId: string, safety: NonNullable<OperationJob["safety"]>) {
  if (safety.accountTargetId) {
    const decision = await resolveAccountAccessDecision({ agentId, workspaceId, targetId: safety.accountTargetId });
    if (decision.approvalRequired || safety.requiresApproval) throw new Error("This operation requires approval before it can be scheduled.");
    if (!decision.allowed) throw new Error(decision.error ?? "Selected account access is denied.");
  }
  if (safety.requiresApproval) throw new Error("This operation requires an approval integration that is not available for scheduled cron execution.");
}
async function assertSafetyForManualRun(action: string, safety: NonNullable<OperationJob["safety"]>, jobId: string) {
  if (action === "run" || action === "retry") {
    if (safety.requiresApproval) throw new Error("Run is pending approval and cannot be queued.");
    if (safety.concurrency === "forbid") {
      const runs = normalizeOpenClawOperationRuns(await getOpenClawAdapter().call<unknown>("cron.runs", { jobId, limit: 10 }), jobId);
      if (runs.some((run) => run.status === "queued" || run.status === "running")) throw new Error("Concurrency policy forbids a second active run.");
    }
  }
}

export function buildOpenClawCronAddParams(input: OperationJobInput) {
  const schedule = input.trigger.kind === "at" ? { kind: "at", at: input.trigger.at }
    : input.trigger.kind === "every" ? { kind: "every", everyMs: input.trigger.everyMs }
    : { kind: "cron", expr: input.trigger.expression, ...(input.trigger.timezone ? { tz: input.trigger.timezone } : {}) };
  return { name: input.name, description: input.description ?? undefined, agentId: input.agentId, enabled: true, schedule,
    sessionTarget: input.context?.sessionTarget ?? "isolated", wakeMode: "now",
    payload: { kind: "agentTurn", message: input.prompt, model: input.model ?? undefined, thinking: input.thinking ?? undefined, lightContext: input.context?.lightContext ?? false },
    delivery: { mode: "none" }, deleteAfterRun: input.trigger.kind === "at" ? false : undefined };
}

export function normalizeOpenClawOperationJob(value: unknown, sidecar: Registry["jobs"], mutable: boolean, history: boolean): OperationJob {
  const raw = record(value); const id = string(raw.jobId) ?? string(raw.id) ?? "unknown"; const schedule = record(raw.schedule); const state = record(raw.state); const payload = record(raw.payload); const side = sidecar[id];
  const trigger = schedule.kind === "at" && string(schedule.at) ? { kind: "at" as const, at: string(schedule.at)!, timezone: null } : schedule.kind === "every" && number(schedule.everyMs) ? { kind: "every" as const, everyMs: number(schedule.everyMs)! } : schedule.kind === "cron" && string(schedule.expr) ? { kind: "cron" as const, expression: string(schedule.expr)!, timezone: string(schedule.tz) } : null;
  const enabled = raw.enabled !== false; const rawStatus = string(raw.status) ?? string(state.lastRunStatus);
  return { id, name: string(raw.name) ?? id, description: string(raw.description), enabled, status: status(rawStatus, enabled, number(state.runningAtMs)), agentId: string(raw.agentId), workspaceId: side?.workspaceId ?? null, prompt: string(payload.message), model: string(payload.model), thinking: string(payload.thinking), trigger, nextRunAt: iso(raw.nextRunAtMs) ?? iso(state.nextRunAtMs), lastRunAt: iso(state.lastRunAtMs), lastRunStatus: rawStatus ?? null, safety: side?.safety ?? null, health: { consecutiveFailures: 0, successRate: null, degraded: false }, capabilities: { readable: true, mutable, runHistory: history, reason: mutable ? null : "Gateway cron mutations are not advertised." } };
}
export function normalizeOpenClawOperationRuns(value: unknown, jobId: string): OperationRun[] { const raw = record(value); const list = Array.isArray(raw.runs) ? raw.runs : Array.isArray(value) ? value : []; return list.map((entry) => { const run = record(entry); const startedAt = iso(run.startedAtMs) ?? string(run.startedAt); const endedAt = iso(run.endedAtMs) ?? string(run.endedAt); return { id: string(run.runId) ?? string(run.id) ?? randomUUID(), jobId, status: runStatus(string(run.status)), startedAt, endedAt, durationMs: number(run.durationMs) ?? (startedAt && endedAt ? Date.parse(endedAt) - Date.parse(startedAt) : null), sessionId: string(run.sessionId) ?? string(run.sessionKey), output: string(run.output) ?? string(run.summary), error: string(run.error), tokens: number(record(run.usage).tokens), cost: number(record(run.usage).cost), artifacts: Array.isArray(run.artifacts) ? run.artifacts.map(String) : [] }; }); }
function reconcileJobWithRuns(job: OperationJob, runs: OperationRun[]): OperationJob {
  const sorted = [...runs].sort((left, right) => Date.parse(right.endedAt ?? right.startedAt ?? "") - Date.parse(left.endedAt ?? left.startedAt ?? ""));
  const active = sorted.find((run) => run.status === "queued" || run.status === "running");
  const latest = sorted.find((run) => run.status === "ok" || run.status === "error" || run.status === "skipped");
  const status = active ? "running" : job.status === "running" && latest?.status === "error" ? "failed"
    : job.status === "running" && latest?.status === "ok" && job.trigger?.kind === "at" ? "completed" : job.status;
  const reconciled = { ...job, status } as OperationJob;
  return { ...reconciled, health: healthFor(reconciled, sorted) };
}
async function hydrateCompletedOperationOutput(job: OperationJob, adapter: ReturnType<typeof getOpenClawAdapter>): Promise<OperationJob> {
  if (job.lastRunStatus !== "ok" || !job.agentId || !job.lastRunAt) return job;
  const cacheKey = `${job.id}:${job.lastRunAt}`;
  const cached = operationOutputCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return { ...job, ...cached.value };
  const sessionKey = `agent:${job.agentId}:cron:${job.id}`;
  try {
    const payload = await adapter.getSessionHistory({ sessionKey, limit: 200 }, { timeoutMs: 8_000 });
    const recentResults = extractAgentChatMessagesFromSessionHistory(payload)
      .filter((message) => message.role === "assistant" && message.text.trim())
      .slice(-24)
      .map((message, index): OperationResult => ({
        id: message.id ?? `${job.id}:${index}`,
        timestamp: operationResultTimestamp(message.timestamp),
        text: message.text.trim()
      }));
    const latestOutput = recentResults.at(-1)?.text ?? null;
    const sessionId = string(payload.sessionId) ?? string(record(payload.sessionInfo).sessionId);
    const value = { latestOutput, recentResults, sessionKey, sessionId };
    operationOutputCache.set(cacheKey, { value, expiresAt: Date.now() + operationOutputCacheTtlMs });
    return { ...job, ...value };
  } catch {
    // A missing/unsupported history capability must not turn a real completed cron job into a fake result.
    return job;
  }
}
function operationResultTimestamp(value: string | number | null) {
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value).toISOString();
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) return new Date(value).toISOString();
  return new Date().toISOString();
}
function healthFor(job: OperationJob, runs: OperationRun[]) { const terminal = runs.filter((run) => run.status === "ok" || run.status === "error" || run.status === "skipped"); let failures = 0; for (const run of runs) { if (run.status === "error") failures += 1; else if (run.status === "ok") break; } return { consecutiveFailures: failures, successRate: terminal.length ? terminal.filter((run) => run.status === "ok").length / terminal.length : null, degraded: failures >= 2 || job.status === "failed" }; }
function status(value: string | null, enabled: boolean, running: number | null): OperationJob["status"] { if (running) return "running"; if (value === "ok") return "completed"; if (value === "error") return "failed"; if (!enabled) return "paused"; if (value === "skipped") return "scheduled"; return "active"; }
function runStatus(value: string | null): OperationRun["status"] { return value === "ok" || value === "error" || value === "skipped" || value === "queued" || value === "running" ? value : "unknown"; }
function normalizeSafety(input: OperationJobInput["safety"]): NonNullable<OperationJob["safety"]> { return { accountTargetId: input?.accountTargetId?.trim() || null, requiresApproval: input?.requiresApproval === true, fileLease: input?.fileLease?.trim() || null, concurrency: input?.concurrency ?? "forbid" }; }
function unavailableSnapshot(audit: OperationAuditEntry[], detail: string): OperationsSnapshot { return { generatedAt: new Date().toISOString(), source: "unavailable", scheduler: { enabled: null, nextWakeAt: null, state: "unsupported" }, jobs: [], runs: [], audit, notices: [{ severity: "warning", title: "Operations unavailable", detail }] }; }
function audit(action: OperationAction, jobId: string | null, outcome: OperationAuditEntry["outcome"], detail: string, requestId: string): OperationAuditEntry { return { id: randomUUID(), at: new Date().toISOString(), action, jobId, outcome, detail, requestId }; }
async function readRegistry(): Promise<Registry> { try { const value = JSON.parse(await readFile(registryPath, "utf8")) as Partial<Registry>; return { version: 1, jobs: value.jobs ?? {}, audit: Array.isArray(value.audit) ? value.audit.slice(0, 500) : [] }; } catch (error) { if (record(error).code === "ENOENT") return { version: 1, jobs: {}, audit: [] }; throw error; } }
async function writeRegistry(registry: Registry) { await mkdir(path.dirname(registryPath), { recursive: true, mode: 0o700 }); const temp = `${registryPath}.${process.pid}.${randomUUID()}.tmp`; await writeFile(temp, `${JSON.stringify({ ...registry, audit: registry.audit.slice(0, 500) }, null, 2)}\n`, { mode: 0o600 }); await rename(temp, registryPath); }
async function appendAudit(entry: OperationAuditEntry) { const registry = await readRegistry(); registry.audit.unshift(entry); await writeRegistry(registry); }
function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function string(value: unknown) { return typeof value === "string" && value.trim() ? value.trim() : null; }
function number(value: unknown) { return typeof value === "number" && Number.isFinite(value) ? value : null; }
function iso(value: unknown) { const ms = number(value); return ms === null ? null : new Date(ms).toISOString(); }
function message(error: unknown) { return error instanceof Error ? error.message : "Unknown operation error."; }

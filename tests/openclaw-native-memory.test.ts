import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  buildMemoryActionResponse,
  executeWorkerMemoryAction,
  getWorkerMemoryProjection,
  normalizeWorkerMemoryProjection,
  normalizeWorkerMemorySearch,
  readWorkerDreamDiary,
  runWorkerMemoryAction,
  searchWorkerMemory
} from "@/lib/openclaw/application/native-memory-service";
import type { OpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import { NativeWsOpenClawGatewayClient } from "@/lib/openclaw/client/native-ws-gateway-client";
import {
  classifyNativeMutationError,
  NativeGatewayRequestError
} from "@/lib/openclaw/client/native-ws-gateway-errors";
import type {
  OpenClawGatewayClient,
  OpenClawMemoryDreamActionPayload,
  OpenClawMemoryStatusPayload
} from "@/lib/openclaw/client/gateway-client";
import type { OpenClawGatewayTransport } from "@/lib/openclaw/client/native-ws-gateway-types";
import {
  createNativeMemoryLoaderState,
  NativeMemoryRequestLedger
} from "@/lib/openclaw/memory-loader-state";

const healthyStatus: OpenClawMemoryStatusPayload = {
  agentId: "worker-1",
  provider: "local",
  embedding: { ok: true, checked: true, checkedAtMs: 1_700_000_000_000 },
  dreaming: {
    enabled: true,
    verboseLogging: false,
    storageMode: "separate",
    separateReports: true,
    shortTermCount: 2,
    recallSignalCount: 3,
    dailySignalCount: 4,
    groundedSignalCount: 5,
    totalSignalCount: 12,
    phaseSignalCount: 1,
    lightPhaseHitCount: 1,
    remPhaseHitCount: 0,
    promotedTotal: 2,
    promotedToday: 1,
    lastPromotedAt: "2026-09-05T08:00:00.000Z"
  }
};

function adapter(overrides: Partial<OpenClawAdapter>): OpenClawAdapter {
  return overrides as OpenClawAdapter;
}

test("native memory methods use the exact Gateway method family", async () => {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const responses: Record<string, unknown> = {
    "memory.search": {
      agentId: "worker-1",
      provider: "local",
      searchMode: "fts-only",
      results: [{
        path: "MEMORY.md",
        startLine: 1,
        endLine: 2,
        score: 0.9,
        snippet: "native memory result",
        source: "memory"
      }]
    },
    "doctor.memory.status": { agentId: "worker-1", embedding: { ok: true } },
    "doctor.memory.dreamDiary": { agentId: "worker-1", found: false, path: "" },
    "doctor.memory.resetDreamDiary": { agentId: "worker-1", action: "reset" }
  };
  const transport = createTransport(calls, responses);
  const fallback = { call: async () => { throw new Error("unexpected CLI fallback"); } } as unknown as OpenClawGatewayClient;
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    transport,
    timeoutMs: 250
  });

  await client.searchMemory?.({ agentId: "worker-1", query: "native", maxResults: 3 });
  await client.getNativeMemoryDoctorStatus?.({ agentId: "worker-1" });
  await client.getNativeMemoryDreamDiary?.({ agentId: "worker-1" });
  await client.resetNativeMemoryDreamDiary?.({ agentId: "worker-1" });

  assert.deepEqual(calls.map(({ method }) => method), [
    "memory.search",
    "doctor.memory.status",
    "doctor.memory.dreamDiary",
    "doctor.memory.resetDreamDiary"
  ]);
  assert.deepEqual(calls[0]?.params, { agentId: "worker-1", query: "native", maxResults: 3 });
});

test("native memory methods reject forced CLI mode instead of falling back", async () => {
  const calls: string[] = [];
  const transport = createTransport([], {}, calls);
  const client = new NativeWsOpenClawGatewayClient({
    fallback: { call: async () => { throw new Error("unexpected CLI fallback"); } } as unknown as OpenClawGatewayClient,
    transport,
    forceCli: true
  });

  await assert.rejects(
    () => client.searchMemory?.({ query: "native" }),
    /CLI fallback is disabled/
  );
  assert.deepEqual(calls, []);
});

test("memory health projection preserves native readiness and separates warnings from errors", () => {
  const healthy = normalizeWorkerMemoryProjection(healthyStatus);
  assert.equal(healthy.status, "healthy");
  assert.equal(healthy.embedding.ready, true);
  assert.equal(healthy.dreaming?.shortTermCount, 2);

  const warning = normalizeWorkerMemoryProjection({
    ...healthyStatus,
    embedding: { ok: false, checked: false, error: "Not checked" }
  });
  assert.equal(warning.status, "degraded");
  assert.equal(warning.issues[0]?.code, "embedding_not_checked");

  const error = normalizeWorkerMemoryProjection({
    ...healthyStatus,
    embedding: { ok: false, checked: true, error: "Embedding provider unavailable" }
  });
  assert.equal(error.status, "needs-attention");
  assert.equal(error.issues[0]?.code, "embedding_unavailable");
});

test("native read failure is unknown while a missing native method is unavailable", async () => {
  const failed = await getWorkerMemoryProjection("worker-1", {
    adapter: adapter({
      async getNativeMemoryDoctorStatus() {
        throw new Error("Gateway timeout while reading memory status");
      }
    })
  });
  assert.equal(failed.status, "unknown");
  assert.equal(failed.source, "unknown");
  assert.equal(failed.issues[0]?.code, "native_read_failed");

  const unavailable = await getWorkerMemoryProjection("worker-1", { adapter: adapter({}) });
  assert.equal(unavailable.status, "unavailable");
  assert.equal(unavailable.source, "unavailable");
  assert.equal(unavailable.issues[0]?.code, "native_method_unavailable");
});

test("memory search preserves bounded native result evidence and redacts content", async () => {
  const result = await searchWorkerMemory({ agentId: "worker-1", query: " decisions ", maxResults: 100 }, {
    adapter: adapter({
      async searchMemory(input) {
        assert.equal(input.query, "decisions");
        assert.equal(input.maxResults, 50);
        return {
          agentId: "worker-1",
          provider: "local",
          searchMode: "hybrid",
          stale: true,
          warning: "index is stale",
          results: [{
            path: "MEMORY.md",
            startLine: 4,
            endLine: 8,
            score: 0.81,
            snippet: "token=secret-value should not be returned",
            source: "memory",
            provenance: { originClass: "owner", sessionKind: "interactive", observedAt: 10 }
          }]
        };
      }
    })
  });
  assert.equal(result.status, "available");
  assert.equal(result.stale, true);
  assert.equal(result.results[0]?.score, 0.81);
  assert.equal(result.results[0]?.provenance?.originClass, "owner");
  assert.doesNotMatch(result.results[0]?.snippet ?? "", /secret-value/);
});

test("native memory actions route through the typed adapter and return a reread projection", () => {
  const action: OpenClawMemoryDreamActionPayload = { agentId: "worker-1", action: "reset" };
  const projection = normalizeWorkerMemoryProjection(healthyStatus);
  const response = buildMemoryActionResponse(action, projection);
  assert.equal(response.action, "reset");
  assert.ok(response.projection);
  assert.equal(response.projection.agentId, "worker-1");
});

test("each memory maintenance action maps to its exact native method without retry", async () => {
  const called: string[] = [];
  const response: OpenClawMemoryDreamActionPayload = { agentId: "worker-1", action: "backfill" };
  const memoryAdapter = adapter({
    async backfillNativeMemoryDreamDiary() { called.push("backfill"); return response; },
    async resetNativeMemoryDreamDiary() { called.push("reset"); return { ...response, action: "reset" }; },
    async resetNativeGroundedShortTerm() { called.push("resetGroundedShortTerm"); return { ...response, action: "resetGroundedShortTerm" }; },
    async repairNativeDreamingArtifacts() { called.push("repairDreamingArtifacts"); return { ...response, action: "repairDreamingArtifacts" }; },
    async dedupeNativeDreamDiary() { called.push("dedupeDreamDiary"); return { ...response, action: "dedupeDreamDiary" }; }
  });

  for (const action of ["backfill", "reset", "resetGroundedShortTerm", "repairDreamingArtifacts", "dedupeDreamDiary"] as const) {
    await runWorkerMemoryAction("worker-1", action, { adapter: memoryAdapter });
  }
  assert.deepEqual(called, ["backfill", "reset", "resetGroundedShortTerm", "repairDreamingArtifacts", "dedupeDreamDiary"]);
});

test("native memory contract changes do not reintroduce the removed remHarness or a CLI product path", async () => {
  const [compatibility, capabilities, service] = await Promise.all([
    readFile("lib/openclaw/client/gateway-compatibility.ts", "utf8"),
    readFile("lib/openclaw/compat/capabilities.ts", "utf8"),
    readFile("lib/openclaw/application/native-memory-service.ts", "utf8")
  ]);
  assert.doesNotMatch(compatibility, /remHarness/);
  assert.doesNotMatch(capabilities, /remHarness/);
  assert.doesNotMatch(service, /gatewaySurfaceCall|CliOpenClawGatewayClient/);
});

test("diary read failures remain unknown and do not claim an empty diary", async () => {
  const result = await readWorkerDreamDiary("worker-1", {
    adapter: adapter({
      async getNativeMemoryDreamDiary() {
        throw new Error("permission denied");
      }
    })
  });
  assert.equal(result.status, "unknown");
  assert.equal(result.found, null);
  assert.equal(result.issue?.code, "native_read_failed");
});

test("normalization rejects empty memory search queries before native access", async () => {
  await assert.rejects(
    () => searchWorkerMemory({ agentId: "worker-1", query: "   ", maxResults: 1 }, { adapter: adapter({}) }),
    /query is required/
  );
  assert.deepEqual(normalizeWorkerMemorySearch([], "worker-1", "local", "fts-only", false).results, []);
});

test("memory loader state resets every worker-bound value on an agent change", () => {
  const state = createNativeMemoryLoaderState("worker-b");
  assert.deepEqual(state, {
    agentId: "worker-b",
    projection: null,
    diary: null,
    searchResult: null,
    isLoadingStatus: false,
    isLoadingDiary: false,
    isSearching: false,
    activeAction: null,
    actionResult: null,
    error: null
  });
});

test("memory loader request ledger fences cross-worker and older same-worker responses", () => {
  const ledger = new NativeMemoryRequestLedger("worker-a");
  const statusA = ledger.begin("status", "worker-a");
  ledger.switchAgent("worker-b");
  assert.equal(ledger.isCurrent(statusA, "worker-b"), false);

  const searchA = ledger.begin("search", "worker-b");
  const searchB = ledger.begin("search", "worker-b");
  assert.equal(ledger.isCurrent(searchA, "worker-b"), false);
  assert.equal(ledger.isCurrent(searchB, "worker-b"), true);
});

test("native mutation classification uses structured transport certainty", () => {
  const timeout = new NativeGatewayRequestError("request timed out", "doctor.memory.resetDreamDiary", true, { kind: "timeout" });
  const forbidden = new NativeGatewayRequestError("forbidden", "doctor.memory.resetDreamDiary", true, { kind: "scope-limited" });
  assert.equal(classifyNativeMutationError(timeout).disposition, "ambiguous-outcome");
  assert.equal(classifyNativeMutationError(forbidden).disposition, "definite-rejection");
  assert.equal(classifyNativeMutationError(new Error("request timed out")).disposition, "ambiguous-outcome");
});

test("ambiguous reset reconciles through one native diary read without retry", async () => {
  let mutationCalls = 0;
  let diaryReads = 0;
  const result = await executeWorkerMemoryAction("worker-1", "reset", {
    adapter: adapter({
      async resetNativeMemoryDreamDiary() {
        mutationCalls += 1;
        throw new NativeGatewayRequestError("request timed out", "doctor.memory.resetDreamDiary", true, { kind: "timeout" });
      },
      async getNativeMemoryDreamDiary() {
        diaryReads += 1;
        return { agentId: "worker-1", found: false, path: "" };
      }
    })
  });
  assert.equal(result.outcome, "succeeded");
  assert.equal(result.reconciliation.status, "confirmed");
  assert.deepEqual(result.reconciliation.readMethods, ["doctor.memory.dreamDiary"]);
  assert.equal(result.retryable, false);
  assert.equal(mutationCalls, 1);
  assert.equal(diaryReads, 1);
});

test("ambiguous reset stays unknown when the native postcondition is inconclusive", async () => {
  let mutationCalls = 0;
  const result = await executeWorkerMemoryAction("worker-1", "reset", {
    adapter: adapter({
      async resetNativeMemoryDreamDiary() {
        mutationCalls += 1;
        throw new NativeGatewayRequestError("connection closed", "doctor.memory.resetDreamDiary", true, { kind: "unreachable" });
      },
      async getNativeMemoryDreamDiary() {
        return { agentId: "worker-1", found: true, path: "", content: "still present" };
      }
    })
  });
  assert.equal(result.outcome, "unknown");
  assert.equal(result.issue?.code, "mutation_outcome_unknown");
  assert.equal(result.retryable, false);
  assert.equal(mutationCalls, 1);
});

test("ambiguous grounded short-term reset confirms a zero native count", async () => {
  const result = await executeWorkerMemoryAction("worker-1", "resetGroundedShortTerm", {
    adapter: adapter({
      async resetNativeGroundedShortTerm() {
        throw new NativeGatewayRequestError("request timed out", "doctor.memory.resetGroundedShortTerm", true, { kind: "timeout" });
      },
      async getNativeMemoryDoctorStatus() {
        return {
          ...healthyStatus,
          dreaming: { ...healthyStatus.dreaming!, shortTermCount: 0 }
        };
      }
    })
  });
  assert.equal(result.outcome, "succeeded");
  assert.equal(result.reconciliation.status, "confirmed");
  assert.equal(result.projection?.dreaming?.shortTermCount, 0);
});

test("definite native rejection does not run a postcondition guess", async () => {
  let diaryReads = 0;
  const result = await executeWorkerMemoryAction("worker-1", "reset", {
    adapter: adapter({
      async resetNativeMemoryDreamDiary() {
        throw new NativeGatewayRequestError("missing scope", "doctor.memory.resetDreamDiary", true, { kind: "scope-limited" });
      },
      async getNativeMemoryDreamDiary() {
        diaryReads += 1;
        return { agentId: "worker-1", found: false, path: "" };
      }
    })
  });
  assert.equal(result.outcome, "failed");
  assert.equal(result.issue?.code, "mutation_rejected");
  assert.equal(result.reconciliation.attempted, false);
  assert.equal(diaryReads, 0);
});

test("missing native mutation methods are definite unsupported failures", async () => {
  let diaryReads = 0;
  const result = await executeWorkerMemoryAction("worker-1", "reset", {
    adapter: adapter({
      async getNativeMemoryDreamDiary() {
        diaryReads += 1;
        return { agentId: "worker-1", found: false, path: "" };
      }
    })
  });
  assert.equal(result.outcome, "failed");
  assert.equal(result.issue?.code, "mutation_rejected");
  assert.equal(result.reconciliation.attempted, false);
  assert.equal(diaryReads, 0);
});

function createTransport(
  calls: Array<{ method: string; params: Record<string, unknown> }>,
  responses: Record<string, unknown>,
  methodCalls: string[] = []
): OpenClawGatewayTransport {
  return {
    async request<TPayload>(method: string, params: Record<string, unknown>) {
      methodCalls.push(method);
      calls.push({ method, params });
      return (responses[method] ?? { protocol: 4 }) as TPayload;
    },
    async probe() {
      return { protocol: 4 };
    },
    async subscribe() {
      return { close() {} };
    },
    close() {},
    getDiagnostics() {
      return {} as never;
    },
    getOperatorIdentity() {
      return {} as never;
    },
    getGeneration() {
      return 1;
    },
    getLifecycleState() {
      return "connected" as never;
    }
  };
}

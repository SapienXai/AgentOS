import "server-only";

import { randomUUID } from "node:crypto";

import {
  getOpenClawAdapter,
  type OpenClawAdapter
} from "@/lib/openclaw/adapter/openclaw-adapter";
import {
  ModelSetupWizardLifecycle,
  type ModelSetupWizardLifecycleTransport
} from "@/lib/openclaw/domains/model-setup-wizard-lifecycle";
import {
  parseModelSetupWizardResult,
  parseModelSetupWizardStartResult,
  parseModelSetupWizardStatus,
} from "@/lib/openclaw/domains/model-setup-wizard";

const SETUP_START_WAIT_TIMEOUT_MS = 30_000;
// Keep the underlying request alive past the client deadline so a late Gateway
// admission can still be reconciled and cancelled by the retained lifecycle.
const SETUP_START_RPC_TIMEOUT_MS = 60_000;
const WIZARD_NEXT_TIMEOUT_MS = 120_000;
const WIZARD_STATUS_TIMEOUT_MS = 15_000;
const WIZARD_CANCEL_TIMEOUT_MS = 15_000;

type SetupStartMethod =
  | "openclaw.setup.auth.start"
  | "openclaw.setup.prepare.start"
  | "openclaw.setup.activate.start";

type SetupStartInput = {
  actorId?: string;
  method: SetupStartMethod;
  authChoice?: string;
  kind?: string;
  apiKey?: string;
  modelRef?: string;
  agentId?: string;
  workspace?: string;
  signal?: AbortSignal;
};

type CapturedAdapter = {
  adapter: OpenClawAdapter;
  connection: ReturnType<NonNullable<OpenClawAdapter["getConnectionIdentity"]>> | null;
};

type ManagedWizardSession = CapturedAdapter & {
  ownerActorId?: string;
  lifecycle: ModelSetupWizardLifecycle;
};

const activeSessions = new Map<string, ManagedWizardSession>();
const pendingStarts = new Map<string, { lifecycle: ModelSetupWizardLifecycle; ownerActorId?: string }>();

export async function startModelSetupWizard(input: SetupStartInput) {
  const sessionId = randomUUID();
  const captured = captureAdapter();
  const params = {
    sessionId,
    ...(input.method === "openclaw.setup.auth.start"
      ? { authChoice: requiredAuthChoice(input.authChoice) }
      : input.method === "openclaw.setup.prepare.start"
        ? { authChoice: requiredAuthChoice(input.authChoice) }
        : { kind: input.kind ?? "api-key", ...(input.authChoice ? { authChoice: input.authChoice } : {}) }),
    ...(input.apiKey ? { apiKey: input.apiKey } : {}),
    ...(input.modelRef ? { modelRef: input.modelRef } : {}),
    ...(input.agentId ? { agentId: input.agentId } : {}),
    ...(input.workspace ? { workspace: input.workspace } : {})
  };
  const lifecycle = new ModelSetupWizardLifecycle(
    sessionId,
    createWizardTransport(captured.adapter, input.method, params),
    {
      startWaitMs: SETUP_START_WAIT_TIMEOUT_MS,
      signal: input.signal
    }
  );
  pendingStarts.set(sessionId, { lifecycle, ownerActorId: input.actorId });
  void lifecycle.whenCleanupSettled().finally(() => {
    if (pendingStarts.get(sessionId)?.lifecycle === lifecycle) pendingStarts.delete(sessionId);
  });

  try {
    const wizard = await lifecycle.start();
    pendingStarts.delete(sessionId);
    if (!wizard.done) {
      activeSessions.set(sessionId, {
        ...captured,
        ownerActorId: input.actorId,
        connection: captured.adapter.getConnectionIdentity?.() ?? captured.connection,
        lifecycle
      });
    }
    return { sessionId, wizard };
  } catch (error) {
    if (lifecycle.phase !== "abandoned-awaiting-cleanup") pendingStarts.delete(sessionId);
    throw error;
  }
}

function requiredAuthChoice(value: string | undefined) {
  const normalized = value?.trim();
  if (!normalized) throw new Error("Choose an OpenClaw authentication method.");
  return normalized;
}

export async function advanceModelSetupWizardSession(
  sessionId: string,
  answer?: { stepId: string; value?: unknown },
  signal?: AbortSignal,
  actorId?: string
) {
  const managed = activeSessions.get(sessionId);
  if (!managed) throw new Error("Provider setup session is no longer active.");
  assertSessionOwner(managed.ownerActorId, actorId);
  assertCurrentConnection(managed);
  try {
    const result = await managed.lifecycle.advance(answer, signal);
    if (result.done) activeSessions.delete(sessionId);
    return result;
  } catch (error) {
    activeSessions.delete(sessionId);
    throw error;
  }
}

export async function cancelModelSetupWizardSession(sessionId: string, actorId?: string) {
  const pending = pendingStarts.get(sessionId);
  if (pending) {
    assertSessionOwner(pending.ownerActorId, actorId);
    return pending.lifecycle.cancel();
  }

  const managed = activeSessions.get(sessionId);
  if (!managed) throw new Error("Provider setup session is no longer active.");
  assertSessionOwner(managed.ownerActorId, actorId);
  activeSessions.delete(sessionId);
  return managed.lifecycle.cancel();
}

export async function readModelSetupWizardStatus(sessionId: string, actorId?: string) {
  const managed = activeSessions.get(sessionId);
  if (!managed) throw new Error("Provider setup session is no longer active.");
  assertSessionOwner(managed.ownerActorId, actorId);
  assertCurrentConnection(managed);
  const status = await managed.lifecycle.status();
  if (status.status !== "running") activeSessions.delete(sessionId);
  return status;
}

/** Test-only cleanup for deterministic service-level lifecycle tests. */
export async function resetModelSetupWizardSessionsForTesting() {
  const sessions = [
    ...[...activeSessions.values()].map((session) => session.lifecycle),
    ...[...pendingStarts.values()].map((pending) => pending.lifecycle)
  ];
  activeSessions.clear();
  pendingStarts.clear();
  await Promise.all(sessions.map((session) => session.cancel().catch(() => undefined)));
}

function assertSessionOwner(expectedActorId: string | undefined, actorId: string | undefined) {
  if (expectedActorId && expectedActorId !== actorId) {
    throw new Error("Provider setup session is not owned by this AgentOS actor.");
  }
}

function captureAdapter(): CapturedAdapter {
  const root = getOpenClawAdapter();
  const adapter = root.capture?.() ?? root;
  return { adapter, connection: adapter.getConnectionIdentity?.() ?? null };
}

function assertCurrentConnection(managed: ManagedWizardSession) {
  if (!managed.connection) return;
  const current = getOpenClawAdapter().getConnectionIdentity?.();
  if (!current) return;
  const changed = current.client !== managed.connection.client ||
    (managed.connection.connectionId !== null && current.connectionId !== managed.connection.connectionId);
  if (!changed) return;

  activeSessions.delete(managed.lifecycle.sessionId);
  void managed.lifecycle.cancel().catch(() => undefined);
  throw new Error("OpenClaw reconnected while provider setup was in progress. Start the connection again.");
}

function createWizardTransport(
  adapter: OpenClawAdapter,
  method: SetupStartMethod,
  params: Record<string, unknown>
): ModelSetupWizardLifecycleTransport {
  return {
    // The start call intentionally has no request signal. The lifecycle races
    // it against the client deadline while retaining the promise for cleanup.
    start: async () => parseModelSetupWizardStartResult(
      await adapter.call<unknown>(method, params, { timeoutMs: SETUP_START_RPC_TIMEOUT_MS })
    ),
    next: async (answer, signal) => parseModelSetupWizardResult(
      await adapter.call<unknown>(
        "wizard.next",
        { sessionId: params.sessionId, ...(answer ? { answer } : {}) },
        { timeoutMs: WIZARD_NEXT_TIMEOUT_MS, ...(signal ? { signal } : {}) }
      )
    ),
    status: async () => parseModelSetupWizardStatus(
      await adapter.call<unknown>(
        "wizard.status",
        { sessionId: params.sessionId },
        { timeoutMs: WIZARD_STATUS_TIMEOUT_MS }
      )
    ),
    cancel: async () => parseModelSetupWizardStatus(
      await adapter.call<unknown>(
        "wizard.cancel",
        { sessionId: params.sessionId },
        { timeoutMs: WIZARD_CANCEL_TIMEOUT_MS }
      )
    )
  };
}

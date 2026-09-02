import "server-only";

import { randomUUID } from "node:crypto";

import { getOpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import {
  advanceModelSetupWizard,
  parseModelSetupWizardResult,
  parseModelSetupWizardStartResult,
  parseModelSetupWizardStatus,
  type ModelSetupWizardResult,
  type ModelSetupWizardStartResult
} from "@/lib/openclaw/domains/model-setup-wizard";

const SETUP_START_TIMEOUT_MS = 30_000;
const WIZARD_NEXT_TIMEOUT_MS = 120_000;
const WIZARD_CANCEL_TIMEOUT_MS = 15_000;

type SetupStartMethod =
  | "openclaw.setup.auth.start"
  | "openclaw.setup.prepare.start"
  | "openclaw.setup.activate.start";

type SetupStartInput = {
  method: SetupStartMethod;
  authChoice?: string;
  kind?: string;
  apiKey?: string;
  modelRef?: string;
  agentId?: string;
  workspace?: string;
  signal?: AbortSignal;
};

export async function startModelSetupWizard(input: SetupStartInput) {
  const sessionId = randomUUID();
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
  const adapter = getOpenClawAdapter();

  try {
    const raw = await adapter.call<unknown>(input.method, params, {
      timeoutMs: SETUP_START_TIMEOUT_MS,
      ...(input.signal ? { signal: input.signal } : {})
    });
    const started = parseModelSetupWizardStartResult(raw);
    if (started.sessionId !== sessionId) {
      throw new Error("OpenClaw returned a mismatched provider setup session.");
    }
    const wizard = await settleStartedWizard(adapter, sessionId, started, input.signal);
    return { sessionId, wizard };
  } catch (error) {
    await cancelModelSetupWizardSession(sessionId).catch(() => undefined);
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
  signal?: AbortSignal
) {
  const adapter = getOpenClawAdapter();
  try {
    const first = parseModelSetupWizardResult(
      await adapter.call<unknown>(
        "wizard.next",
        { sessionId, ...(answer ? { answer } : {}) },
        { timeoutMs: WIZARD_NEXT_TIMEOUT_MS, ...(signal ? { signal } : {}) }
      )
    );
    return await advanceModelSetupWizard(
      first,
      async () =>
        parseModelSetupWizardResult(
          await adapter.call<unknown>("wizard.next", { sessionId }, {
            timeoutMs: WIZARD_NEXT_TIMEOUT_MS,
            ...(signal ? { signal } : {})
          })
        ),
      { signal }
    );
  } catch (error) {
    await cancelModelSetupWizardSession(sessionId).catch(() => undefined);
    throw error;
  }
}

export async function cancelModelSetupWizardSession(sessionId: string) {
  const payload = await getOpenClawAdapter().call<unknown>(
    "wizard.cancel",
    { sessionId },
    { timeoutMs: WIZARD_CANCEL_TIMEOUT_MS }
  );
  return parseModelSetupWizardStatus(payload);
}

export async function readModelSetupWizardStatus(sessionId: string) {
  const payload = await getOpenClawAdapter().call<unknown>(
    "wizard.status",
    { sessionId },
    { timeoutMs: WIZARD_CANCEL_TIMEOUT_MS }
  );
  return parseModelSetupWizardStatus(payload);
}

async function settleStartedWizard(
  adapter: ReturnType<typeof getOpenClawAdapter>,
  sessionId: string,
  started: ModelSetupWizardStartResult,
  signal?: AbortSignal
): Promise<ModelSetupWizardResult> {
  const initial: ModelSetupWizardResult = {
    done: started.done,
    ...(started.step ? { step: started.step } : {}),
    ...(started.status ? { status: started.status } : {}),
    ...(started.error ? { error: started.error } : {}),
    ...(started.preparedModelRef ? { preparedModelRef: started.preparedModelRef } : {}),
    ...(started.modelActivation ? { modelActivation: started.modelActivation } : {})
  };
  return advanceModelSetupWizard(
    initial,
    async () =>
      parseModelSetupWizardResult(
        await adapter.call<unknown>("wizard.next", { sessionId }, {
          timeoutMs: WIZARD_NEXT_TIMEOUT_MS,
          ...(signal ? { signal } : {})
        })
      ),
    { signal }
  );
}

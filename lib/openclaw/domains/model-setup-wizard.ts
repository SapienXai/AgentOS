import { z } from "zod";

export const modelSetupWizardStepTypes = [
  "note",
  "select",
  "multiselect",
  "text",
  "confirm",
  "progress",
  "action"
] as const;

export type ModelSetupWizardStepType = (typeof modelSetupWizardStepTypes)[number];
export type ModelSetupWizardStatus = "running" | "done" | "cancelled" | "error";
export type ModelSetupWizardExecutor = "gateway" | "client";

export type ModelSetupWizardStepOption = {
  value: unknown;
  label: string;
  hint?: string;
};

export type ModelSetupWizardStep = {
  id: string;
  type: ModelSetupWizardStepType;
  title?: string;
  message?: string;
  format?: "plain";
  options?: ModelSetupWizardStepOption[];
  initialValue?: unknown;
  placeholder?: string;
  sensitive?: boolean;
  executor?: ModelSetupWizardExecutor;
  externalUrl?: string;
  deviceCode?: {
    code: string;
    expiresInMinutes?: number;
    message?: string;
  };
};

export type ModelSetupWizardActivation = {
  modelRef: string;
  gatewayRestartRequired?: true;
};

export type ModelSetupWizardResult = {
  done: boolean;
  step?: ModelSetupWizardStep;
  status?: ModelSetupWizardStatus;
  error?: string;
  preparedModelRef?: string;
  modelActivation?: ModelSetupWizardActivation;
};

export type ModelSetupWizardStartResult = ModelSetupWizardResult & {
  sessionId: string;
};

const wizardStepSchema = z
  .object({
    id: z.string().min(1),
    type: z.enum(modelSetupWizardStepTypes),
    title: z.string().optional(),
    message: z.string().optional(),
    format: z.literal("plain").optional(),
    options: z
      .array(
        z.object({ value: z.unknown(), label: z.string().min(1), hint: z.string().optional() })
      )
      .optional(),
    initialValue: z.unknown().optional(),
    placeholder: z.string().optional(),
    sensitive: z.boolean().optional(),
    executor: z.enum(["gateway", "client"]).optional(),
    externalUrl: z.string().optional(),
    deviceCode: z
      .object({
        code: z.string().min(1),
        expiresInMinutes: z.number().int().min(1).max(1440).optional(),
        message: z.string().optional()
      })
      .optional()
  })
  .passthrough();

export const modelSetupWizardResultSchema = z
  .object({
    done: z.boolean(),
    step: wizardStepSchema.optional(),
    status: z.enum(["running", "done", "cancelled", "error"]).optional(),
    error: z.string().optional(),
    preparedModelRef: z.string().min(1).optional(),
    modelActivation: z
      .object({ modelRef: z.string().min(1), gatewayRestartRequired: z.literal(true).optional() })
      .optional()
  })
  .passthrough();

export const modelSetupWizardStartResultSchema = modelSetupWizardResultSchema.extend({
  sessionId: z.string().min(1)
});

export const modelSetupWizardStatusSchema = z.object({
  status: z.enum(["running", "done", "cancelled", "error"]),
  error: z.string().optional()
});

export function parseModelSetupWizardResult(payload: unknown): ModelSetupWizardResult {
  return sanitizeModelSetupWizardResult(
    modelSetupWizardResultSchema.parse(payload) as ModelSetupWizardResult
  );
}

export function parseModelSetupWizardStartResult(payload: unknown): ModelSetupWizardStartResult {
  const parsed = modelSetupWizardStartResultSchema.parse(payload) as ModelSetupWizardStartResult;
  return {
    ...sanitizeModelSetupWizardResult(parsed),
    sessionId: parsed.sessionId
  };
}

export function parseModelSetupWizardStatus(payload: unknown) {
  return modelSetupWizardStatusSchema.parse(payload);
}

export type ModelSetupWizardResultPhase =
  | "step"
  | "progressing"
  | "done"
  | "error"
  | "cancelled";

/** A terminal result is successful only when the Gateway explicitly says done. */
export function modelSetupWizardResultPhase(
  result: ModelSetupWizardResult
): ModelSetupWizardResultPhase {
  if (result.done === true && result.status === "done") return "done";
  if (result.done === true && result.status === "cancelled") return "cancelled";
  if (result.done === true && result.status === "error") return "error";
  if (result.done === false && result.step) {
    return result.step.executor === "gateway" ? "progressing" : "step";
  }
  if (result.done === false && result.status === "running") return "progressing";
  return "error";
}

export function isSuccessfulModelSetupWizardResult(result: ModelSetupWizardResult) {
  return modelSetupWizardResultPhase(result) === "done";
}

export function initialModelSetupWizardValue(step: ModelSetupWizardStep): unknown {
  if (step.type === "multiselect") {
    return Array.isArray(step.initialValue) ? [...step.initialValue] : [];
  }
  if (step.type === "confirm") {
    return step.initialValue === true;
  }
  return step.initialValue ?? "";
}

function isSamePrimitive(left: unknown, right: unknown) {
  return (
    (typeof left === "string" || typeof left === "number" || typeof left === "boolean" || left === null) &&
    (typeof right === "string" || typeof right === "number" || typeof right === "boolean" || right === null) &&
    Object.is(left, right)
  );
}

export function toggleModelSetupWizardSelection(current: unknown, optionValue: unknown) {
  const selected = Array.isArray(current) ? current : [];
  const existingIndex = selected.findIndex((value) => isSamePrimitive(value, optionValue));
  if (existingIndex >= 0) {
    return selected.filter((_, index) => index !== existingIndex);
  }
  return [...selected, optionValue];
}

export function answerForModelSetupWizardStep(step: ModelSetupWizardStep, value: unknown) {
  if (step.type === "confirm") return value === true;
  if (step.type === "multiselect") {
    return Array.isArray(value) ? value : [];
  }
  return value;
}

/** OpenClaw normally sanitizes this before sending it, but keep the boundary
 * safe if a Gateway/plugin accidentally includes a sensitive initial value. */
export function sanitizeModelSetupWizardResult(result: ModelSetupWizardResult): ModelSetupWizardResult {
  if (!result.step?.sensitive || !Object.prototype.hasOwnProperty.call(result.step, "initialValue")) {
    return result;
  }

  const safeStep = { ...result.step };
  delete safeStep.initialValue;
  return { ...result, step: safeStep };
}

export function wizardStateFromResult(
  authChoice: string,
  result: ModelSetupWizardResult,
  fallbackError = "OpenClaw could not complete provider setup."
): ModelSetupWizardState {
  const phase = modelSetupWizardResultPhase(result);
  if (phase === "step" || phase === "progressing") {
    if (!result.step) {
      return { phase: "progressing", authChoice, busy: true, validationError: null, message: "OpenClaw is preparing provider setup." };
    }
    return {
      phase: "step",
      authChoice,
      step: result.step,
      busy: false,
      validationError: result.error?.trim() || null
    };
  }
  if (phase === "done") {
    return {
      phase: "done",
      authChoice,
      ...(result.preparedModelRef ? { preparedModelRef: result.preparedModelRef } : {}),
      ...(result.modelActivation ? { modelActivation: result.modelActivation } : {}),
      ready: Boolean(result.modelActivation),
      gatewayRestartRequired: result.modelActivation?.gatewayRestartRequired === true
    };
  }
  if (phase === "cancelled") {
    return { phase: "cancelled", message: result.error?.trim() || "Provider setup was cancelled." };
  }
  return { phase: "error", message: result.error?.trim() || fallbackError };
}

export type ModelSetupWizardState =
  | { phase: "idle" }
  | { phase: "starting"; authChoice: string }
  | {
      phase: "step" | "progressing";
      authChoice: string;
      step?: ModelSetupWizardStep;
      busy: boolean;
      validationError: string | null;
      message?: string;
    }
  | {
      phase: "done";
      authChoice: string;
      preparedModelRef?: string;
      modelActivation?: ModelSetupWizardActivation;
      ready: boolean;
      gatewayRestartRequired: boolean;
    }
  | { phase: "cancelled"; message: string }
  | { phase: "error"; message: string };

export type ModelSetupWizardNextTransport = (
  answer?: { stepId: string; value?: unknown }
) => Promise<ModelSetupWizardResult>;

export type ModelSetupWizardAdvanceOptions = {
  maxGatewaySteps?: number;
  deadlineMs?: number;
  now?: () => number;
  signal?: AbortSignal;
};

/**
 * Mirrors OpenClaw's ModelSetupWizardRunner: gateway-owned steps are
 * acknowledged automatically; client-owned steps are returned to the UI.
 */
export async function advanceModelSetupWizard(
  initial: ModelSetupWizardResult,
  next: ModelSetupWizardNextTransport,
  options: ModelSetupWizardAdvanceOptions = {}
): Promise<ModelSetupWizardResult> {
  const maxGatewaySteps = options.maxGatewaySteps ?? 32;
  const deadline = (options.now ?? Date.now)() + (options.deadlineMs ?? 120_000);
  let current = initial;
  let steps = 0;
  let primeRunningSession = !initial.step && initial.done === false && initial.status === "running";

  while (true) {
    if (options.signal?.aborted) throw new DOMException("Wizard request was cancelled.", "AbortError");
    const phase = modelSetupWizardResultPhase(current);
    if (phase === "done" || phase === "error" || phase === "cancelled") return current;
    const shouldAdvance = current.step?.executor === "gateway" || (primeRunningSession && !current.step);
    if (!shouldAdvance) return current;
    primeRunningSession = false;
    if (steps >= maxGatewaySteps || (options.now ?? Date.now)() >= deadline) {
      throw new Error("OpenClaw provider setup is taking longer than expected. Try again.");
    }
    current = parseModelSetupWizardResult(await next());
    steps += 1;
  }
}

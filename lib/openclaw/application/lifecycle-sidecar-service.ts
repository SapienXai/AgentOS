import "server-only";

import { redactSecretText } from "@/lib/security/redaction";
import type { LifecycleOperationItemState } from "@/lib/openclaw/application/lifecycle-operation-store";

export type LifecycleSidecarStep = {
  id?: string;
  label: string;
  run: () => Promise<unknown>;
  formatError?: (error: unknown) => string | null;
};

export type LifecycleSidecarRunOptions = {
  completed?: Record<string, LifecycleOperationItemState>;
  onSuccess?: (stepId: string) => Promise<void> | void;
  onFailure?: (stepId: string) => Promise<void> | void;
};

export type LifecycleSidecarResult = {
  sidecarSynchronized: boolean;
  warnings: string[];
};

/**
 * Runs best-effort AgentOS cleanup after native OpenClaw state is confirmed.
 * Sidecars are never allowed to turn a confirmed native mutation into a false
 * native failure, and one failed step does not prevent independent cleanup.
 */
export async function runLifecycleSidecarSteps(
  steps: readonly LifecycleSidecarStep[],
  options: LifecycleSidecarRunOptions = {}
): Promise<LifecycleSidecarResult> {
  const warnings: string[] = [];

  for (const step of steps) {
    const stepId = step.id ?? step.label;
    if (options.completed?.[stepId] === "confirmed" || options.completed?.[stepId] === "skipped") {
      continue;
    }

    try {
      await step.run();
      await options.onSuccess?.(stepId);
    } catch (error) {
      const formatted = step.formatError?.(error);
      warnings.push(formatted || `AgentOS could not ${step.label}: ${safeLifecycleSidecarError(error)}.`);
      await Promise.resolve(options.onFailure?.(stepId)).catch(() => undefined);
    }
  }

  return {
    sidecarSynchronized: warnings.length === 0,
    warnings: [...new Set(warnings.filter(Boolean))]
  };
}

function safeLifecycleSidecarError(error: unknown) {
  return error instanceof Error
    ? redactSecretText(error.message).replace(/[\r\n]+/g, " ").slice(0, 240)
    : "unknown error";
}

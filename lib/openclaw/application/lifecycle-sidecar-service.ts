import "server-only";

import { redactSecretText } from "@/lib/security/redaction";

export type LifecycleSidecarStep = {
  label: string;
  run: () => Promise<unknown>;
  formatError?: (error: unknown) => string | null;
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
  steps: readonly LifecycleSidecarStep[]
): Promise<LifecycleSidecarResult> {
  const warnings: string[] = [];

  for (const step of steps) {
    try {
      await step.run();
    } catch (error) {
      const formatted = step.formatError?.(error);
      warnings.push(formatted || `AgentOS could not ${step.label}: ${safeLifecycleSidecarError(error)}.`);
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

export const workspaceCreationReviewReadinessStatuses = [
  "ready",
  "design-incomplete",
  "plan-rebuild-required",
  "refresh-required",
  "blocked"
] as const;

export type WorkspaceCreationReviewReadinessStatus = (typeof workspaceCreationReviewReadinessStatuses)[number];

export const workspaceCreationReviewRequiredActions = [
  "none",
  "retry-design",
  "rebuild-plan",
  "refresh-context",
  "resolve-conflict",
  "accept-draft"
] as const;

export type WorkspaceCreationReviewRequiredAction = (typeof workspaceCreationReviewRequiredActions)[number];

export const workspaceCreationReviewReadinessReasonCodes = [
  "ready",
  "blueprint-invalid",
  "blueprint-blocked",
  "architect-fallback",
  "draft-acceptance-required",
  "context-stale",
  "context-unknown",
  "composition-missing",
  "composition-invalid",
  "composition-mismatch",
  "composition-blocked",
  "composition-rebuild-failed",
  "abandoned"
] as const;

export type WorkspaceCreationReviewReadinessReasonCode = (typeof workspaceCreationReviewReadinessReasonCodes)[number];

/**
 * Server-owned certification of the review-to-provision handoff.
 * The browser may present this value, but it must not infer it from a
 * Blueprint, freshness result, or draft context id on its own.
 */
export type WorkspaceCreationReviewReadiness = {
  status: WorkspaceCreationReviewReadinessStatus;
  provisionable: boolean;
  reasonCode: WorkspaceCreationReviewReadinessReasonCode;
  requiredAction: WorkspaceCreationReviewRequiredAction;
  message: string;
  checkedAt: string;
  blueprintFingerprint: string | null;
  planId: string | null;
  planFingerprint: string | null;
};

export function validateWorkspaceCreationReviewReadiness(value: unknown): value is WorkspaceCreationReviewReadiness {
  if (!value || typeof value !== "object") return false;
  const readiness = value as Record<string, unknown>;
  return Object.keys(readiness).every((key) => [
    "status", "provisionable", "reasonCode", "requiredAction", "message", "checkedAt",
    "blueprintFingerprint", "planId", "planFingerprint"
  ].includes(key))
    && workspaceCreationReviewReadinessStatuses.includes(readiness.status as WorkspaceCreationReviewReadinessStatus)
    && typeof readiness.provisionable === "boolean"
    && workspaceCreationReviewReadinessReasonCodes.includes(readiness.reasonCode as WorkspaceCreationReviewReadinessReasonCode)
    && workspaceCreationReviewRequiredActions.includes(readiness.requiredAction as WorkspaceCreationReviewRequiredAction)
    && typeof readiness.message === "string"
    && readiness.message.length <= 300
    && typeof readiness.checkedAt === "string"
    && (readiness.blueprintFingerprint === null || typeof readiness.blueprintFingerprint === "string")
    && (readiness.planId === null || typeof readiness.planId === "string")
    && (readiness.planFingerprint === null || typeof readiness.planFingerprint === "string");
}

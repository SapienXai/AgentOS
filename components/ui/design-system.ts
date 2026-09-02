/**
 * Shared AgentOS UI contracts.
 *
 * Keep this file deliberately small: it describes reusable semantic vocabulary,
 * not a second component framework or a replacement for feature-local visuals.
 */

export type AgentOsSurfaceTheme = "dark" | "light";

export type AgentOsStatusTone = "success" | "info" | "warning" | "danger" | "muted" | "purple";

export type AgentOsUiState =
  | "active"
  | "idle"
  | "pending"
  | "running"
  | "success"
  | "degraded"
  | "blocked"
  | "unsupported"
  | "unknown"
  | "failed"
  | "recovering"
  | "disabled";

export type AgentOsUiStateDefinition = Readonly<{
  tone: AgentOsStatusTone;
  meaning: string;
  actionRequired: boolean;
  recoveryAvailable: boolean;
  informational: boolean;
}>;

export const AGENTOS_UI_STATE_DEFINITIONS = {
  active: {
    tone: "info",
    meaning: "The operator or runtime is active and available for the current workflow.",
    actionRequired: false,
    recoveryAvailable: false,
    informational: true
  },
  idle: {
    tone: "muted",
    meaning: "No work is currently running, but the surface remains available.",
    actionRequired: false,
    recoveryAvailable: false,
    informational: true
  },
  pending: {
    tone: "warning",
    meaning: "The requested work is waiting for a dependency, queue, or confirmation.",
    actionRequired: false,
    recoveryAvailable: false,
    informational: true
  },
  running: {
    tone: "info",
    meaning: "Work is in progress; keep progress and the next expected transition visible.",
    actionRequired: false,
    recoveryAvailable: false,
    informational: true
  },
  success: {
    tone: "success",
    meaning: "The operation completed successfully.",
    actionRequired: false,
    recoveryAvailable: false,
    informational: true
  },
  degraded: {
    tone: "warning",
    meaning: "The capability is usable with a limitation or reduced confidence.",
    actionRequired: true,
    recoveryAvailable: true,
    informational: false
  },
  blocked: {
    tone: "danger",
    meaning: "The workflow cannot continue until a dependency, approval, or policy issue is resolved.",
    actionRequired: true,
    recoveryAvailable: true,
    informational: false
  },
  unsupported: {
    tone: "muted",
    meaning: "The current runtime or product surface does not support this capability.",
    actionRequired: true,
    recoveryAvailable: false,
    informational: false
  },
  unknown: {
    tone: "muted",
    meaning: "The state is not verified; never present it as healthy or complete.",
    actionRequired: true,
    recoveryAvailable: true,
    informational: false
  },
  failed: {
    tone: "danger",
    meaning: "The operation did not complete successfully.",
    actionRequired: true,
    recoveryAvailable: true,
    informational: false
  },
  recovering: {
    tone: "warning",
    meaning: "A recovery action is in progress or the runtime is returning to a usable state.",
    actionRequired: false,
    recoveryAvailable: true,
    informational: true
  },
  disabled: {
    tone: "muted",
    meaning: "The capability is intentionally disabled and will not act until enabled.",
    actionRequired: false,
    recoveryAvailable: false,
    informational: true
  }
} as const satisfies Record<AgentOsUiState, AgentOsUiStateDefinition>;

export function getAgentOsUiStateDefinition(state: AgentOsUiState): AgentOsUiStateDefinition {
  return AGENTOS_UI_STATE_DEFINITIONS[state];
}

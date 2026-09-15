import type { CommandResult } from "@/lib/openclaw/cli";
import type { OpenClawConfigMutationMetadata, OpenClawConfigReloadKind } from "@/lib/openclaw/client/types";

export type OpenClawConfigApplyMode = "live" | "reload" | "restart" | "pending" | "unknown";

export type OpenClawConfigMutationOutcome = {
  path: string;
  applyMode: OpenClawConfigApplyMode;
  reloadKind: OpenClawConfigReloadKind;
  restartRequired: boolean;
  hotReloaded: boolean;
  appliedVia: OpenClawConfigMutationMetadata["appliedVia"] | "unknown";
  pending: boolean;
  baseHash: string | null;
  changedPaths: string[];
};

export function readConfigMutationOutcome(result: CommandResult, fallbackPath: string): OpenClawConfigMutationOutcome {
  const parsed = parseJsonObject(result.stdout);
  const metadata = isRecord(result.metadata?.openClawConfig) ? result.metadata.openClawConfig : null;
  const mutation = isRecord(parsed?.configMutation) ? parsed.configMutation : null;
  const source = mutation ?? metadata;
  const pending = result.metadata?.pending === true || parsed?.pending === true;
  const reloadKind = normalizeReloadKind(source?.reloadKind);
  const appliedVia = normalizeAppliedVia(source?.appliedVia);

  return {
    path: typeof source?.path === "string" && source.path.trim() ? source.path : fallbackPath,
    applyMode: pending ? "pending" : resolveApplyMode(reloadKind),
    reloadKind,
    restartRequired: typeof source?.restartRequired === "boolean" ? source.restartRequired : reloadKind === "restart",
    hotReloaded: typeof source?.hotReloaded === "boolean" ? source.hotReloaded : reloadKind === "hot",
    appliedVia,
    pending,
    baseHash: typeof source?.baseHash === "string" && source.baseHash.trim() ? source.baseHash : null,
    changedPaths: normalizeChangedPaths(source?.changedPaths)
  };
}

export function combineConfigMutationOutcomes(outcomes: OpenClawConfigMutationOutcome[], fallbackPath: string) {
  const applyMode = outcomes.reduce<OpenClawConfigApplyMode>((current, outcome) => {
    return rankApplyMode(outcome.applyMode) > rankApplyMode(current) ? outcome.applyMode : current;
  }, "live");

  return {
    path: fallbackPath,
    applyMode: outcomes.length === 0 ? "live" : applyMode,
    reloadKind: outcomes.some((outcome) => outcome.reloadKind === "restart")
      ? "restart"
      : outcomes.some((outcome) => outcome.reloadKind === "hot")
        ? "hot"
        : outcomes.every((outcome) => outcome.reloadKind === "none")
          ? "none"
          : "unknown",
    restartRequired: outcomes.some((outcome) => outcome.restartRequired),
    hotReloaded: outcomes.length > 0 && outcomes.every((outcome) => outcome.hotReloaded),
    appliedVia: outcomes.length === 1 && outcomes[0] ? outcomes[0].appliedVia : "unknown",
    pending: outcomes.some((outcome) => outcome.pending),
    baseHash: outcomes.length === 1 && outcomes[0] ? outcomes[0].baseHash : null,
    changedPaths: Array.from(new Set(outcomes.flatMap((outcome) => outcome.changedPaths)))
  } satisfies OpenClawConfigMutationOutcome;
}

function resolveApplyMode(reloadKind: OpenClawConfigReloadKind): OpenClawConfigApplyMode {
  switch (reloadKind) {
    case "none":
      return "live";
    case "hot":
      return "reload";
    case "restart":
      return "restart";
    default:
      return "unknown";
  }
}

function rankApplyMode(mode: OpenClawConfigApplyMode) {
  switch (mode) {
    case "pending":
      return 4;
    case "restart":
      return 3;
    case "reload":
      return 2;
    case "unknown":
      return 1;
    case "live":
      return 0;
  }
}

function normalizeReloadKind(value: unknown): OpenClawConfigReloadKind {
  return value === "restart" || value === "hot" || value === "none" ? value : "unknown";
}

function normalizeAppliedVia(value: unknown): OpenClawConfigMutationOutcome["appliedVia"] {
  return value === "config.patch" || value === "config.apply" || value === "config.set" || value === "noop"
    ? value
    : "unknown";
}

function normalizeChangedPaths(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0).slice(0, 256)
    : [];
}

function parseJsonObject(value: string) {
  try {
    const parsed: unknown = JSON.parse(value || "{}");
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

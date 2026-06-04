import type { MissionControlSnapshot } from "@/lib/openclaw/types";
import {
  buildOpenAiCodexAuthLoginCommand,
  buildOpenAiCodexAuthRepairCommand,
  isOpenAiCodexAuthFailure,
  isOpenAiCodexProviderPluginMissing,
  resolveOpenAiCodexAuthRecoveryMessage,
  resolveOpenAiCodexProviderPluginRecoveryMessage
} from "@/lib/openclaw/model-auth-errors";

type SmokeTestFailureKind = "model-route" | "plugin-runtime" | "provider-auth" | "session-store-permission";

type SmokeTestFailureClassification = {
  kind: SmokeTestFailureKind;
  detail: string;
};

export function resolveOpenClawRuntimePreflightError(snapshot: Pick<MissionControlSnapshot, "diagnostics">) {
  const combinedIssues = [
    ...(snapshot.diagnostics.issues ?? []),
    ...(snapshot.diagnostics.runtime.issues ?? [])
  ]
    .filter((issue): issue is string => typeof issue === "string")
    .join("\n");

  if (
    /failed to load bundled channel/i.test(combinedIssues) ||
    /plugin-runtime-deps/i.test(combinedIssues) ||
    /\bENOENT\b/i.test(combinedIssues)
  ) {
    return "OpenClaw runtime is missing bundled channel files after the update. Run `openclaw doctor --fix` and restart the gateway.";
  }

  return null;
}

export function classifyOpenClawRuntimeSmokeTestFailure(output: string): SmokeTestFailureClassification | null {
  const normalized = output.trim();

  if (!normalized) {
    return null;
  }

  if (
    isOpenAiCodexProviderPluginMissing(normalized)
  ) {
    return {
      kind: "provider-auth",
      detail: resolveOpenAiCodexProviderPluginRecoveryMessage(
        buildOpenAiCodexAuthRepairCommand("openclaw")
      )
    };
  }

  if (
    isOpenAiCodexAuthFailure(normalized)
  ) {
    return {
      kind: "provider-auth",
      detail: resolveOpenAiCodexAuthRecoveryMessage(buildOpenAiCodexAuthLoginCommand("openclaw"))
    };
  }

  if (
    /\bEPERM\b/i.test(normalized) &&
    (/\.openclaw\/agents\/.*\/sessions/i.test(normalized) || /\.fs-safe-replace/i.test(normalized))
  ) {
    return {
      kind: "session-store-permission",
      detail:
        "AgentOS cannot write the OpenClaw agent session store. Start AgentOS outside the sandbox or grant write access to ~/.openclaw, then retry the chat."
    };
  }

  if (
    /Unknown model:\s*openai-codex\/gpt-[^\s.]+(?:[-.][^\s.]*)*/i.test(normalized) ||
    /Do not use `?openai-codex\/gpt-\*`?/i.test(normalized) ||
    /not supported by the OpenAI Codex OAuth route/i.test(normalized)
  ) {
    return {
      kind: "model-route",
      detail:
        "OpenClaw rejected a legacy Codex model route. Use canonical `openai/gpt-5.5` model refs with the Codex harness enabled, then run `openclaw doctor --fix` to migrate stale `openai-codex/gpt-*` config entries."
    };
  }

  if (
    /failed to load bundled channel/i.test(normalized) ||
    /plugin-runtime-deps/i.test(normalized) ||
    /\bENOENT\b/i.test(normalized)
  ) {
    return {
      kind: "plugin-runtime",
      detail:
        "bundled channel loading failed after the update. Run `openclaw doctor --fix` and restart the gateway."
    };
  }

  return null;
}

export function buildOpenClawRuntimeSmokeTestRecoveryCommand(command: string, output: string) {
  const classification = classifyOpenClawRuntimeSmokeTestFailure(output);

  if (classification?.kind === "model-route") {
    return `${command} doctor --fix && ${command} gateway restart && ${command} gateway status --deep`;
  }

  if (classification?.kind === "provider-auth") {
    return isOpenAiCodexProviderPluginMissing(output)
      ? buildOpenAiCodexAuthRepairCommand(command)
      : buildOpenAiCodexAuthLoginCommand(command);
  }

  if (classification?.kind === "session-store-permission") {
    return `${command} doctor && ${command} status --json`;
  }

  return `${command} doctor --fix && ${command} gateway restart && ${command} gateway status --deep`;
}

export function resolveOpenClawRuntimeFailureMessage(output: string) {
  const classification = classifyOpenClawRuntimeSmokeTestFailure(output);

  if (!classification) {
    return null;
  }

  return classification.detail;
}

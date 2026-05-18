import {
  formatModelProviderLabel,
  modelProviderRegistry,
  normalizeAddModelsProviderId
} from "@/lib/openclaw/model-provider-registry";
import {
  resolveGatewayAuthRepairAction,
  type GatewayAuthRepairAction
} from "@/lib/openclaw/gateway-auth-actions";
import type { AddModelsProviderId } from "@/lib/openclaw/types";

export type AgentChatAuthAction = {
  provider: AddModelsProviderId;
  label: string;
  detail: string;
};

export type AgentChatGatewayRepairAction = GatewayAuthRepairAction;

export function resolveAgentChatAuthAction(
  message: string | null | undefined,
  modelId?: string | null
): AgentChatAuthAction | null {
  const normalizedMessage = message?.trim() ?? "";

  if (!normalizedMessage || !isLikelyAuthFailure(normalizedMessage)) {
    return null;
  }

  const provider =
    resolveProviderFromAuthCommand(normalizedMessage) ??
    resolveProviderFromKnownCopy(normalizedMessage) ??
    resolveProviderFromModelId(modelId, normalizedMessage);

  if (!provider) {
    return null;
  }

  const label = formatModelProviderLabel(provider);

  return {
    provider,
    label,
    detail: `Connect ${label}, then retry this chat message.`
  };
}

export function resolveAgentChatGatewayRepairAction(
  message: string | null | undefined
): AgentChatGatewayRepairAction | null {
  return resolveGatewayAuthRepairAction(message);
}

function resolveProviderFromAuthCommand(message: string) {
  const providerMatch =
    message.match(/\bmodels\s+auth\s+(?:login|paste-token)\b[\s\S]*?--provider(?:=|\s+)(["']?)([a-z0-9_-]+)\1/i) ??
    message.match(/\b--provider(?:=|\s+)(["']?)([a-z0-9_-]+)\1/i);

  return normalizeAddModelsProviderId(providerMatch?.[2] ?? null);
}

function resolveProviderFromKnownCopy(message: string) {
  if (/\bChatGPT\/Codex\b|\bChatGPT\b|\bCodex\b/i.test(message)) {
    return "openai-codex";
  }

  const lowerMessage = message.toLowerCase();
  for (const provider of modelProviderRegistry) {
    const id = provider.id.toLowerCase();
    const label = provider.label.toLowerCase();
    const shortLabel = provider.shortLabel.toLowerCase();

    if (
      lowerMessage.includes(id) ||
      lowerMessage.includes(label) ||
      lowerMessage.includes(shortLabel)
    ) {
      return provider.id;
    }
  }

  return null;
}

function resolveProviderFromModelId(modelId: string | null | undefined, message: string) {
  const modelProvider = modelId?.split("/", 1)[0]?.trim() ?? "";

  if (!modelProvider) {
    return null;
  }

  if (modelProvider === "openai" && /\bChatGPT\b|\bCodex\b/i.test(message)) {
    return "openai-codex";
  }

  return normalizeAddModelsProviderId(modelProvider);
}

function isLikelyAuthFailure(message: string) {
  return /\b(auth|authentication|authenticate|unauthorized|unauthorised|forbidden|expired|token|oauth|api[-\s]?key|credential|login|sign[ -]?in|reconnect|401|403)\b/i.test(message);
}

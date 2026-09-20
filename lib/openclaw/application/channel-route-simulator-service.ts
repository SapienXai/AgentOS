import "server-only";

import type { OpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import { getOpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import { getChannelCenterSnapshot, type ChannelCenterSnapshot } from "@/lib/openclaw/application/channel-center-service";
import { getChannelRouteBinding, type ChannelRouteBindingResolution } from "@/lib/openclaw/application/channel-route-binding-service";
import {
  normalizeTelegramSenderId,
  readTelegramRoutePolicy,
  type TelegramRoutePolicyRead
} from "@/lib/openclaw/application/telegram-group-permissions-service";
import { getWorkerEffectiveCapabilities } from "@/lib/openclaw/application/worker-capability-service";
import type { ChannelRouteIdentity } from "@/lib/openclaw/domains/channel-center";
import type { EffectiveCapability, OpenClawAgent } from "@/lib/openclaw/types";
import { redactErrorMessage } from "@/lib/security/redaction";

export type ChannelRouteSimulationOutcome = "deliverable" | "blocked" | "ambiguous" | "unresolved" | "unknown";
export type ChannelRouteSimulationGateStatus = "pass" | "fail" | "unknown" | "warning" | "info";

export type ChannelRouteSimulationInput = {
  route: ChannelRouteIdentity;
  senderId: string | null;
  mentioned: boolean | null;
  message?: string | null;
  expectedAgentId?: string | null;
};

export type ChannelRouteSimulationPolicy = {
  availability: "available" | "unsupported" | "unavailable";
  groupId: string | null;
  topicId: string | null;
  enabled: boolean | null;
  groupPolicy: string | null;
  allowFrom: string[];
  requireMention: boolean | null;
  source: "openclaw" | "unknown";
  inheritance: TelegramRoutePolicyRead["inheritance"];
  warnings: string[];
  explanation: string;
};

export type ChannelRouteSimulationResult = {
  capturedAt: string;
  input: ChannelRouteSimulationInput;
  outcome: ChannelRouteSimulationOutcome;
  binding: {
    effectiveAgentId: string | null;
    explicitAgentId: string | null;
    match: ChannelRouteBindingResolution["match"];
    effectiveMatch: ChannelRouteBindingResolution["effectiveMatch"];
    matchedBy: ChannelRouteBindingResolution["matchedBy"];
    inheritedFrom: ChannelRouteBindingResolution["inheritedFrom"];
    source: ChannelRouteBindingResolution["source"];
    conflict: ChannelRouteBindingResolution["conflict"];
    shadowedBindingCount: number;
    editingAmbiguity: boolean;
  };
  account: {
    status: "available" | "unavailable" | "unknown";
    label: string | null;
    detail: string;
    source: "channel-center" | "unavailable";
  };
  access: {
    policy: ChannelRouteSimulationPolicy;
    senderGate: ChannelRouteSimulationGate;
    mentionGate: ChannelRouteSimulationGate;
    enabledGate: ChannelRouteSimulationGate;
  };
  worker: {
    id: string | null;
    label: string | null;
    expectedId: string | null;
    expectedMatch: "match" | "mismatch" | "not-requested" | "unknown";
  };
  capabilities: {
    status: "available" | "unavailable" | "unknown";
    sessionKey: string | null;
    summary: Record<string, number> | null;
    entries: Array<Pick<EffectiveCapability, "id" | "label" | "status" | "explanation" | "remediation">>;
    detail: string;
  };
  trace: ChannelRouteSimulationTraceStep[];
  explanations: string[];
};

export type ChannelRouteSimulationGate = {
  status: ChannelRouteSimulationGateStatus;
  label: string;
  detail: string;
  source?: string | null;
};

export type ChannelRouteSimulationTraceStep = {
  id: string;
  label: string;
  status: ChannelRouteSimulationGateStatus;
  detail: string;
  source?: string | null;
};

export type ChannelRouteSimulationDependencies = {
  adapter?: OpenClawAdapter;
  readChannelCenter?: () => Promise<ChannelCenterSnapshot>;
  readCapabilities?: (agentId: string, options: { adapter: OpenClawAdapter }) => Promise<Awaited<ReturnType<typeof getWorkerEffectiveCapabilities>>>;
  readAgents?: (adapter: OpenClawAdapter) => Promise<OpenClawAgent[]>;
};

export async function simulateChannelRoute(
  input: ChannelRouteSimulationInput,
  dependencies: ChannelRouteSimulationDependencies = {}
): Promise<ChannelRouteSimulationResult> {
  const adapter = dependencies.adapter ?? getOpenClawAdapter();
  const capturedAt = new Date().toISOString();
  const binding = await getChannelRouteBinding(input.route, { adapter });
  const ambiguous = isAmbiguousBinding(binding);
  const effectiveAgentId = ambiguous ? null : binding.agentId;
  const centerResult = await readChannelCenterSafely(dependencies.readChannelCenter ?? getChannelCenterSnapshot);
  const account = projectAccountAvailability(centerResult, input.route.provider, input.route.accountId);
  const policy = await readPolicy(input.route, adapter);
  const worker = await resolveWorker(effectiveAgentId, adapter, dependencies.readAgents);
  const capabilities = await readCapabilitySnapshot(
    effectiveAgentId,
    adapter,
    dependencies.readCapabilities,
    ambiguous
      ? "Capability snapshot unavailable. A single effective worker could not be established because the route is ambiguous."
      : undefined
  );
  const enabledGate = buildEnabledGate(policy);
  const senderGate = buildSenderGate(policy, input.senderId);
  const mentionGate = buildMentionGate(policy, input.mentioned);
  const trace: ChannelRouteSimulationTraceStep[] = [
    {
      id: "account",
      label: "Account available",
      status: account.status === "available" ? "pass" : account.status === "unavailable" ? "fail" : "unknown",
      detail: account.detail,
      source: account.source
    },
    {
      id: "group-enabled",
      label: "Route enabled",
      status: enabledGate.status,
      detail: enabledGate.detail,
      source: enabledGate.source
    },
    {
      id: "sender",
      label: "Sender policy",
      status: senderGate.status,
      detail: senderGate.detail,
      source: senderGate.source
    },
    {
      id: "mention",
      label: "Mention policy",
      status: mentionGate.status,
      detail: mentionGate.detail,
      source: mentionGate.source
    },
    {
      id: "route",
      label: "Worker route",
      status: ambiguous ? "warning" : binding.agentId ? "pass" : "unknown",
      detail: ambiguous
        ? "OpenClaw reported more than one matching route; no worker winner is selected."
        : binding.agentId
          ? describeBinding(binding)
          : "No effective worker was returned by the canonical route resolver.",
      source: binding.source
    }
  ];

  const outcome = resolveOutcome({
    ambiguous,
    account,
    enabledGate,
    senderGate,
    mentionGate,
    policy,
    agentId: effectiveAgentId
  });
  const expectedMatch = input.expectedAgentId
    ? effectiveAgentId
      ? effectiveAgentId === input.expectedAgentId ? "match" : "mismatch"
      : "unknown"
    : "not-requested";

  if (input.expectedAgentId) {
    trace.push({
      id: "expected-worker",
      label: "Expected worker",
      status: expectedMatch === "match" ? "pass" : expectedMatch === "mismatch" ? "warning" : "unknown",
      detail: expectedMatch === "match"
        ? "The resolved worker matches the worker selected as the expected destination."
        : expectedMatch === "mismatch"
          ? `The route resolved to ${worker.label ?? effectiveAgentId ?? "an unknown worker"}, not the expected worker.`
          : "The actual worker could not be compared with the expected worker.",
      source: "AgentOS comparison"
    });
  }

  const explanations = buildExplanations(outcome, input.route, binding, policy, account, senderGate, mentionGate, worker, expectedMatch);
  return {
    capturedAt,
    input,
    outcome,
    binding: {
      effectiveAgentId,
      explicitAgentId: ambiguous ? null : binding.explicitAgentId,
      match: binding.match,
      effectiveMatch: binding.effectiveMatch,
      matchedBy: binding.matchedBy,
      inheritedFrom: binding.inheritedFrom,
      source: binding.source,
      conflict: binding.conflict,
      shadowedBindingCount: binding.shadowedBindings.length,
      editingAmbiguity: binding.editingAmbiguity
    },
    account,
    access: { policy, senderGate, mentionGate, enabledGate },
    worker: {
      id: effectiveAgentId,
      label: ambiguous ? null : worker.label,
      expectedId: input.expectedAgentId ?? null,
      expectedMatch
    },
    capabilities,
    trace,
    explanations
  };
}

async function readPolicy(route: ChannelRouteIdentity, adapter: OpenClawAdapter): Promise<ChannelRouteSimulationPolicy> {
  if (route.provider.toLowerCase() === "telegram" && (route.kind === "group" || route.kind === "topic")) {
    try {
      const read = await readTelegramRoutePolicy({
        accountId: route.accountId,
        groupId: route.kind === "topic" ? route.parentRouteId ?? "" : route.routeId,
        topicId: route.kind === "topic" ? route.routeId : null,
        adapter
      });
      return {
        availability: "available",
        groupId: read.groupId,
        topicId: read.topicId,
        enabled: read.enabled,
        groupPolicy: read.groupPolicy,
        allowFrom: read.allowFrom,
        requireMention: read.requireMention,
        source: read.source,
        inheritance: read.inheritance,
        warnings: read.warnings,
        explanation: "Telegram policy was read from the effective OpenClaw provider, account, group, and topic configuration."
      };
    } catch (error) {
      return unavailablePolicy(redactErrorMessage(error, "Telegram policy could not be verified."));
    }
  }

  return {
    ...unavailablePolicy(`${route.provider} route binding can be inspected, but sender and mention policy simulation is not available for this provider.`),
    explanation: `${route.provider} route binding can be inspected, but AgentOS does not have enough canonical policy evidence to simulate access gates.`
  };
}

function unavailablePolicy(explanation: string): ChannelRouteSimulationPolicy {
  return {
    availability: "unsupported",
    groupId: null,
    topicId: null,
    enabled: null,
    groupPolicy: null,
    allowFrom: [],
    requireMention: null,
    source: "unknown",
    inheritance: [],
    warnings: [explanation],
    explanation
  };
}

async function readChannelCenterSafely(reader: () => Promise<ChannelCenterSnapshot>) {
  try {
    return await reader();
  } catch {
    return null;
  }
}

function projectAccountAvailability(center: ChannelCenterSnapshot | null, providerId: string, accountId: string): ChannelRouteSimulationResult["account"] {
  const provider = center?.providers.find((candidate) => candidate.id === providerId);
  const account = provider?.accounts.find((candidate) => candidate.accountId === accountId);
  if (!account) {
    return {
      status: "unknown",
      label: null,
      detail: center ? "OpenClaw did not return a matching account in Channel Center inventory." : "Channel Center account lifecycle evidence was unavailable.",
      source: center ? "channel-center" : "unavailable"
    };
  }
  if (account.authenticationRequired || account.enabled === false || account.connected === false && account.running === false) {
    return {
      status: "unavailable",
      label: account.name,
      detail: account.authenticationRequired ? "This account requires authentication before it can receive messages." : account.lastError ?? "The account is not connected or running.",
      source: "channel-center"
    };
  }
  if (!account.liveStatusAvailable || account.connected !== true) {
    return {
      status: "unknown",
      label: account.name,
      detail: account.evidence === "config-only" ? "The account is present in configuration, but live channel availability was not verified." : "The account is configured, but OpenClaw did not confirm a connected live status.",
      source: "channel-center"
    };
  }
  return { status: "available", label: account.name, detail: "OpenClaw reports the account as connected and available.", source: "channel-center" };
}

function buildEnabledGate(policy: ChannelRouteSimulationPolicy): ChannelRouteSimulationGate {
  if (policy.availability !== "available") return { status: "unknown", label: "Route policy", detail: policy.explanation, source: policy.source };
  if (policy.enabled === false || policy.groupPolicy === "disabled") return { status: "fail", label: "Route enabled", detail: "OpenClaw marks this route or group as disabled.", source: "OpenClaw policy" };
  if (policy.enabled === true) return { status: "pass", label: "Route enabled", detail: "The effective route is enabled.", source: "OpenClaw policy" };
  return { status: "unknown", label: "Route enabled", detail: "OpenClaw did not expose a deterministic enabled state for this route.", source: "OpenClaw policy" };
}

function isAmbiguousBinding(binding: ChannelRouteBindingResolution) {
  return binding.editingAmbiguity
    || Boolean(binding.conflict)
    || ["shadowed", "overlapping", "ambiguous-edit", "conflict"].includes(binding.match);
}

function buildSenderGate(policy: ChannelRouteSimulationPolicy, senderId: string | null): ChannelRouteSimulationGate {
  if (policy.availability !== "available") return { status: "unknown", label: "Sender policy", detail: "Sender eligibility is unavailable for this provider.", source: policy.source };
  if (policy.groupPolicy === "open") return { status: "pass", label: "Sender policy", detail: "The effective group policy accepts any sender.", source: "OpenClaw policy" };
  if (policy.groupPolicy === "disabled") return { status: "fail", label: "Sender policy", detail: "The effective group policy accepts no senders.", source: "OpenClaw policy" };
  if (policy.groupPolicy !== "allowlist") return { status: "unknown", label: "Sender policy", detail: "The effective sender policy is not known.", source: "OpenClaw policy" };
  if (!senderId) return { status: "unknown", label: "Sender policy", detail: "Provide a sender ID to evaluate the effective Telegram allowlist.", source: "OpenClaw policy" };
  const normalizedSenderId = normalizeTelegramSenderId(senderId);
  if (!normalizedSenderId) return { status: "unknown", label: "Sender policy", detail: "A numeric Telegram user ID is required to evaluate this allowlist.", source: "Operator input" };
  if (policy.allowFrom.length === 0) return { status: "fail", label: "Sender policy", detail: "The effective allowlist is empty, so no sender is eligible.", source: "OpenClaw policy" };
  return policy.allowFrom.includes(normalizedSenderId)
    ? { status: "pass", label: "Sender policy", detail: `Sender ${normalizedSenderId} appears in the effective allowlist.`, source: "OpenClaw policy" }
    : { status: "fail", label: "Sender policy", detail: `Sender ${normalizedSenderId} is not present in the effective allowlist.`, source: "OpenClaw policy" };
}

function buildMentionGate(policy: ChannelRouteSimulationPolicy, mentioned: boolean | null): ChannelRouteSimulationGate {
  if (policy.availability !== "available" || policy.requireMention === null) return { status: "unknown", label: "Mention policy", detail: "Mention policy could not be verified.", source: policy.source };
  if (!policy.requireMention) return { status: "pass", label: "Mention policy", detail: "The route does not require a bot mention.", source: "OpenClaw policy" };
  if (mentioned === true) return { status: "pass", label: "Mention policy", detail: "The simulation says the bot was mentioned.", source: "Operator input" };
  if (mentioned === false) return { status: "fail", label: "Mention policy", detail: "The route requires a bot mention and the simulation says it was not mentioned.", source: "Operator input" };
  return { status: "unknown", label: "Mention policy", detail: "The route requires a bot mention, but the simulation did not establish whether it was mentioned.", source: "Operator input" };
}

function resolveOutcome(input: {
  ambiguous: boolean;
  account: ChannelRouteSimulationResult["account"];
  enabledGate: ChannelRouteSimulationGate;
  senderGate: ChannelRouteSimulationGate;
  mentionGate: ChannelRouteSimulationGate;
  policy: ChannelRouteSimulationPolicy;
  agentId: string | null;
}): ChannelRouteSimulationOutcome {
  if (input.ambiguous) return "ambiguous";
  if (input.account.status === "unavailable" || input.enabledGate.status === "fail" || input.senderGate.status === "fail" || input.mentionGate.status === "fail") return "blocked";
  if (input.account.status === "unknown" || input.enabledGate.status === "unknown" || input.senderGate.status === "unknown" || input.mentionGate.status === "unknown") return "unknown";
  if (input.policy.availability !== "available") return "unknown";
  if (!input.agentId) return "unresolved";
  return "deliverable";
}

async function resolveWorker(agentId: string | null, adapter: OpenClawAdapter, reader?: (adapter: OpenClawAdapter) => Promise<OpenClawAgent[]>): Promise<{ id: string | null; label: string | null }> {
  if (!agentId) return { id: null, label: null };
  try {
    const agents = await (reader ?? (async (currentAdapter) => (await currentAdapter.listAgents({ timeoutMs: 8_000 })).agents))(adapter);
    const agent = agents.find((candidate) => candidate.id === agentId);
    return { id: agentId, label: agent?.name ?? agentId };
  } catch {
    return { id: agentId, label: agentId };
  }
}

async function readCapabilitySnapshot(
  agentId: string | null,
  adapter: OpenClawAdapter,
  reader?: ChannelRouteSimulationDependencies["readCapabilities"],
  unavailableDetail?: string
): Promise<ChannelRouteSimulationResult["capabilities"]> {
  if (!agentId) return {
    status: "unknown",
    sessionKey: null,
    summary: null,
    entries: [],
    detail: unavailableDetail ?? "No resolved worker exists for a capability snapshot."
  };
  try {
    const payload = await (reader ?? getWorkerEffectiveCapabilities)(agentId, { adapter });
    return {
      status: "available",
      sessionKey: payload.session.key,
      summary: payload.summary,
      entries: payload.capabilities.map((capability) => ({
        id: capability.id,
        label: capability.label,
        status: capability.status,
        explanation: capability.explanation,
        ...(capability.remediation ? { remediation: capability.remediation } : {})
      })),
      detail: payload.session.key
        ? `Based on current OpenClaw effective capability evidence for session ${shortId(payload.session.key)}. This may differ when a new channel session is created.`
        : "OpenClaw returned no session context, so configured capabilities are not presented as effective."
    };
  } catch (error) {
    return { status: "unavailable", sessionKey: null, summary: null, entries: [], detail: redactErrorMessage(error, "Effective capability context is unavailable.") };
  }
}

function describeBinding(binding: ChannelRouteBindingResolution) {
  const match = binding.effectiveMatch === "exact" ? "exact" : binding.effectiveMatch === "fallback" ? "default" : "inherited";
  return `${match} route via ${binding.matchedBy ?? "OpenClaw binding"}${binding.inheritedFrom ? ` from ${binding.inheritedFrom.routeId}` : ""}.`;
}

function buildExplanations(outcome: ChannelRouteSimulationOutcome, route: ChannelRouteIdentity, binding: ChannelRouteBindingResolution, policy: ChannelRouteSimulationPolicy, account: ChannelRouteSimulationResult["account"], sender: ChannelRouteSimulationGate, mention: ChannelRouteSimulationGate, worker: { id: string | null; label: string | null }, expectedMatch: ChannelRouteSimulationResult["worker"]["expectedMatch"]) {
  const explanations = [
    outcome === "deliverable"
      ? `Eligible for delivery to ${worker.label ?? worker.id ?? "the resolved worker"} under the currently observed routing and access policy.`
      : outcome === "blocked"
        ? "The hypothetical message would not pass the currently observed delivery gates."
        : outcome === "ambiguous"
          ? "OpenClaw reported an ambiguous route, so AgentOS does not select a worker winner."
          : outcome === "unresolved"
            ? "The route is known, but no effective worker was returned by OpenClaw."
            : "AgentOS could not establish a deterministic delivery conclusion from the available OpenClaw evidence.",
    `Route source: ${binding.source === "openclaw" ? "OpenClaw native binding" : binding.source === "agentos-compatibility" ? "AgentOS compatibility projection" : "unknown"}.`,
    `Policy source: ${policy.source === "openclaw" ? "OpenClaw configuration" : "unavailable or unsupported"}.`,
    `Account evidence: ${account.detail}`
  ];
  if (sender.status === "fail") explanations.push(sender.detail);
  if (mention.status === "fail") explanations.push(mention.detail);
  if (expectedMatch === "mismatch") explanations.push("The resolved worker does not match the expected worker supplied by the originating surface.");
  if (route.kind === "topic" && binding.inheritedFrom) explanations.push(`The topic inherits its worker route from the parent ${binding.inheritedFrom.kind} route.`);
  return explanations;
}

function shortId(value: string) {
  return `${value.slice(0, 8)}…`;
}

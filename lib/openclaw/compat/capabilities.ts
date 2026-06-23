import {
  OPENCLAW_GATEWAY_BASELINE_OPTIONAL_METHODS,
  OPENCLAW_GATEWAY_BASELINE_REQUIRED_METHODS
} from "@/lib/openclaw/client/gateway-compatibility";
import { compareVersionStrings } from "@/lib/openclaw/domains/control-plane-normalization";
import { OPENCLAW_SUPPORTED_BASELINE_VERSION } from "@/lib/openclaw/versions";
import type {
  OpenClawCompatibilityCapability,
  OpenClawCompatibilityCapabilityId,
  OpenClawCompatibilityCapabilitySource,
  OpenClawCompatibilityDetectionInput,
  OpenClawCompatibilityMethodSource,
  OpenClawCompatibilitySupportStatus
} from "@/lib/openclaw/compat/types";

type CapabilityDefinition = {
  id: OpenClawCompatibilityCapabilityId;
  label: string;
  methods: string[];
  events?: string[];
};

const capabilityDefinitions: CapabilityDefinition[] = [
  {
    id: "gatewayHealth",
    label: "Gateway health",
    methods: ["health", "status", "logs.tail", "diagnostics.stability", "gateway.identity.get"]
  },
  {
    id: "presence",
    label: "Presence",
    methods: ["system-presence", "last-heartbeat", "set-heartbeats"],
    events: ["presence", "tick", "health", "heartbeat", "shutdown"]
  },
  {
    id: "sessions",
    label: "Sessions",
    methods: [
      "sessions.list",
      "sessions.resolve",
      "sessions.create",
      "sessions.send",
      "sessions.abort",
      "sessions.patch",
      "sessions.reset",
      "sessions.delete",
      "sessions.compact",
      "sessions.steer",
      "sessions.preview",
      "sessions.get",
      "sessions.describe",
      "sessions.subscribe",
      "sessions.unsubscribe",
      "sessions.messages.subscribe",
      "sessions.messages.unsubscribe"
    ],
    events: ["chat", "session.message", "session.operation", "session.tool", "sessions.changed"]
  },
  {
    id: "chat",
    label: "Chat",
    methods: ["chat.send", "sessions.send", "chat.history", "chat.abort", "chat.inject", "chat.message.get"],
    events: ["chat", "agent", "session.message", "session.tool"]
  },
  {
    id: "agents",
    label: "Agents",
    methods: ["agents.list", "agents.create", "agents.update", "agents.delete", "agent.identity.get"]
  },
  {
    id: "agentFiles",
    label: "Agent files",
    methods: ["agents.files.list", "agents.files.get", "agents.files.set"]
  },
  {
    id: "models",
    label: "Models",
    methods: ["models.list", "models.authStatus", "models.scan", "models.authOrder.set", "models.auth.order.set"]
  },
  {
    id: "authProfiles",
    label: "Auth profiles",
    methods: ["models.authStatus", "models.authOrder.set", "models.auth.order.set"]
  },
  {
    id: "usage",
    label: "Usage and cost",
    methods: ["usage.status", "usage.cost", "sessions.usage", "sessions.usage.timeseries", "sessions.usage.logs"]
  },
  {
    id: "memory",
    label: "Memory doctor",
    methods: [
      "doctor.memory.status",
      "doctor.memory.dreamDiary",
      "doctor.memory.backfillDreamDiary",
      "doctor.memory.resetDreamDiary",
      "doctor.memory.resetGroundedShortTerm",
      "doctor.memory.repairDreamingArtifacts",
      "doctor.memory.dedupeDreamDiary",
      "doctor.memory.remHarness"
    ]
  },
  {
    id: "accountsBrowserProfiles",
    label: "Accounts/browser profiles",
    methods: ["browser.request", "channels.status", "web.login.start", "web.login.wait"]
  },
  {
    id: "channels",
    label: "Channels",
    methods: ["channels.status", "channels.logout", "send", "push.test", "voicewake.get", "voicewake.set"],
    events: ["voicewake.changed"]
  },
  {
    id: "talk",
    label: "Talk",
    methods: [
      "talk.catalog",
      "talk.config",
      "talk.session.create",
      "talk.session.join",
      "talk.session.appendAudio",
      "talk.session.startTurn",
      "talk.session.endTurn",
      "talk.session.cancelTurn",
      "talk.session.cancelOutput",
      "talk.session.submitToolResult",
      "talk.session.steer",
      "talk.session.close",
      "talk.mode",
      "talk.client.create",
      "talk.client.toolCall",
      "talk.client.steer",
      "talk.speak"
    ],
    events: ["talk.event"]
  },
  {
    id: "tts",
    label: "Text to speech",
    methods: ["tts.status", "tts.providers", "tts.enable", "tts.disable", "tts.setProvider", "tts.convert"]
  },
  {
    id: "tasks",
    label: "Tasks",
    methods: ["tasks.list", "tasks.get", "tasks.cancel", "tasks.assign"],
    events: ["session.operation", "sessions.changed", "task", "task.updated", "task.completed"]
  },
  {
    id: "artifacts",
    label: "Artifacts",
    methods: ["artifacts.list", "artifacts.get", "artifacts.download", "artifacts.put", "artifacts.delete"],
    events: ["artifact", "artifact.updated"]
  },
  {
    id: "tools",
    label: "Tools",
    methods: ["tools.catalog", "tools.effective", "tools.invoke", "commands.list"]
  },
  {
    id: "approvals",
    label: "Approvals",
    methods: [
      "exec.approval.request",
      "exec.approval.get",
      "exec.approval.list",
      "exec.approval.resolve",
      "exec.approval.waitDecision",
      "exec.approvals.get",
      "exec.approvals.set",
      "exec.approvals.node.get",
      "exec.approvals.node.set",
      "plugin.approval.request",
      "plugin.approval.list",
      "plugin.approval.waitDecision",
      "plugin.approval.resolve"
    ],
    events: ["exec.approval.requested", "exec.approval.resolved", "plugin.approval.requested", "plugin.approval.resolved"]
  },
  {
    id: "devices",
    label: "Devices",
    methods: [
      "device.pair.list",
      "device.pair.approve",
      "device.pair.reject",
      "device.pair.remove",
      "device.token.rotate",
      "device.token.revoke",
      "devices.list"
    ],
    events: ["device.pair.requested", "device.pair.resolved"]
  },
  {
    id: "nodes",
    label: "Nodes",
    methods: [
      "node.pair.request",
      "node.pair.list",
      "node.pair.approve",
      "node.pair.reject",
      "node.pair.remove",
      "node.pair.verify",
      "node.list",
      "node.describe",
      "node.rename",
      "node.invoke",
      "node.invoke.result",
      "node.pending.pull",
      "node.pending.ack",
      "node.pending.enqueue",
      "node.pending.drain"
    ],
    events: ["node.event", "node.pair.requested", "node.pair.resolved"]
  },
  {
    id: "cron",
    label: "Cron automation",
    methods: ["wake", "cron.get", "cron.list", "cron.status", "cron.add", "cron.update", "cron.remove", "cron.run", "cron.runs"],
    events: ["cron"]
  },
  {
    id: "environments",
    label: "Environments",
    methods: ["environments.list", "environments.status"]
  },
  {
    id: "skills",
    label: "Skills",
    methods: ["skills.status", "skills.search", "skills.detail", "skills.install", "skills.update"]
  },
  {
    id: "plugins",
    label: "Plugins",
    methods: ["plugins.uiDescriptors", "plugins.list"]
  },
  {
    id: "updates",
    label: "Updates",
    methods: ["update.status", "update.run"]
  },
  {
    id: "commands",
    label: "Commands",
    methods: ["commands.list"]
  },
  {
    id: "secrets",
    label: "Secrets and wizard",
    methods: ["secrets.reload", "secrets.resolve", "wizard.start", "wizard.next", "wizard.status", "wizard.cancel"]
  },
  {
    id: "config",
    label: "Config",
    methods: ["config.get", "config.set", "config.schema", "config.schema.lookup", "config.patch", "config.apply"]
  },
  {
    id: "transcripts",
    label: "Transcripts",
    methods: ["chat.history", "sessions.preview", "sessions.get", "sessions.describe", "sessions.messages.subscribe"],
    events: ["session.message", "session.tool"]
  },
  {
    id: "cliFallback",
    label: "CLI fallback availability",
    methods: [],
    events: []
  }
];

export function resolveOpenClawCompatibilityMethods(input: {
  advertisedMethods: string[];
  advertisedEvents: string[];
  installedVersion: string | null;
  source: OpenClawCompatibilityMethodSource;
}) {
  const advertisedMethods = uniqueSorted(input.advertisedMethods);
  const advertisedEvents = uniqueSorted(input.advertisedEvents);

  if (advertisedMethods.length > 0 || advertisedEvents.length > 0) {
    return {
      advertisedMethods,
      advertisedEvents,
      effectiveMethods: advertisedMethods,
      effectiveEvents: advertisedEvents,
      source: input.source === "unavailable" ? "gateway-advertised" as const : input.source
    };
  }

  if (isAtLeastBaseline(input.installedVersion)) {
    return {
      advertisedMethods,
      advertisedEvents,
      effectiveMethods: uniqueSorted([
        ...OPENCLAW_GATEWAY_BASELINE_REQUIRED_METHODS,
        ...OPENCLAW_GATEWAY_BASELINE_OPTIONAL_METHODS
      ]),
      effectiveEvents: [],
      source: "version-default" as const
    };
  }

  return {
    advertisedMethods,
    advertisedEvents,
    effectiveMethods: [],
    effectiveEvents: [],
    source: "unavailable" as const
  };
}

export function buildOpenClawCompatibilityCapabilities(
  input: OpenClawCompatibilityDetectionInput & {
    effectiveMethods: string[];
    effectiveEvents: string[];
  }
): OpenClawCompatibilityCapability[] {
  const methodSet = new Set(input.effectiveMethods);
  const eventSet = new Set(input.effectiveEvents);
  const source = toCapabilitySource(input.source);

  return capabilityDefinitions.map((definition) => {
    if (definition.id === "cliFallback") {
      return {
        id: definition.id,
        label: definition.label,
        status: input.cliFallbackAvailable ? "supported" : "not-available",
        source: "cli-probe",
        methods: [],
        events: [],
        supportedMethods: [],
        supportedEvents: [],
        reason: input.cliFallbackAvailable
          ? "OpenClaw CLI is available for explicit recovery fallback operations."
          : "OpenClaw CLI was not available, so recovery fallback operations cannot run."
      } satisfies OpenClawCompatibilityCapability;
    }

    const methods = uniqueSorted(definition.methods);
    const events = uniqueSorted(definition.events ?? []);
    const supportedMethods = methods.filter((method) => methodSet.has(method));
    const supportedEvents = events.filter((event) => eventSet.has(event));
    const status = resolveCapabilityStatus({
      supportedMethods,
      supportedEvents,
      hasEffectiveCapabilities: methodSet.size > 0 || eventSet.size > 0
    });

    return {
      id: definition.id,
      label: definition.label,
      status,
      source: status === "unknown" ? "not-available" : source,
      methods,
      events,
      supportedMethods,
      supportedEvents,
      reason: resolveCapabilityReason(definition.label, status, source, supportedMethods, supportedEvents)
    } satisfies OpenClawCompatibilityCapability;
  });
}

export function uniqueSorted(values: readonly string[]) {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter(Boolean))
  ).sort();
}

function resolveCapabilityStatus(input: {
  supportedMethods: string[];
  supportedEvents: string[];
  hasEffectiveCapabilities: boolean;
}): OpenClawCompatibilitySupportStatus {
  if (input.supportedMethods.length > 0 || input.supportedEvents.length > 0) {
    return "supported";
  }

  return input.hasEffectiveCapabilities ? "unsupported" : "unknown";
}

function resolveCapabilityReason(
  label: string,
  status: OpenClawCompatibilitySupportStatus,
  source: OpenClawCompatibilityCapabilitySource,
  supportedMethods: string[],
  supportedEvents: string[]
) {
  if (status === "supported") {
    const evidence = [...supportedMethods, ...supportedEvents].slice(0, 4).join(", ");
    if (source === "version-default") {
      return `${label} matches the ${OPENCLAW_SUPPORTED_BASELINE_VERSION} version-default expectation, but Gateway did not advertise live capability metadata${evidence ? ` (${evidence})` : ""}.`;
    }

    return `${label} is available via Gateway capability metadata${evidence ? ` (${evidence})` : ""}.`;
  }

  if (status === "unsupported") {
    return `${label} was not present in the detected OpenClaw capability set.`;
  }

  if (status === "not-available") {
    return `${label} is not available in this environment.`;
  }

  return `${label} could not be detected because OpenClaw did not provide capability metadata and no safe version default applies.`;
}

function toCapabilitySource(source: OpenClawCompatibilityMethodSource): OpenClawCompatibilityCapabilitySource {
  switch (source) {
    case "gateway-discovery":
      return "gateway-discovery";
    case "version-default":
      return "version-default";
    case "gateway-advertised":
      return "gateway-advertised";
    case "unavailable":
    default:
      return "not-available";
  }
}

function isAtLeastBaseline(version: string | null) {
  const normalized = version?.trim().replace(/^v/i, "");
  return Boolean(normalized && compareVersionStrings(normalized, OPENCLAW_SUPPORTED_BASELINE_VERSION) >= 0);
}

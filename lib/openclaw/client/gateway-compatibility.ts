import { OPENCLAW_SUPPORTED_BASELINE_VERSION } from "@/lib/openclaw/versions";

export type OpenClawGatewayCompatibilityOperationId =
  | "health"
  | "diagnosticsStability"
  | "gatewayIdentity"
  | "presence"
  | "models"
  | "modelAuthOrder"
  | "modelScan"
  | "usageStatus"
  | "usageCost"
  | "sessionUsage"
  | "memoryDoctor"
  | "logsTail"
  | "messaging"
  | "configSchemaLookup"
  | "configPatch"
  | "secrets"
  | "wizard"
  | "sessionLifecycle"
  | "sessionMutation"
  | "sessionMessages"
  | "chatMessage"
  | "agentCreate"
  | "agentUpdate"
  | "agentIdentity"
  | "agentFiles"
  | "agentDelete"
  | "missionDispatch"
  | "missionStream"
  | "chatControl"
  | "agentWait"
  | "sessionHistory"
  | "taskEvents"
  | "taskAssign"
  | "taskCancel"
  | "artifacts"
  | "artifactDownload"
  | "runtimeSnapshot"
  | "commands"
  | "tools"
  | "plugins"
  | "execApprovals"
  | "pluginApprovals"
  | "devicePairList"
  | "deviceApproval"
  | "deviceToken"
  | "nodePairing"
  | "nodePresence"
  | "nodeInvoke"
  | "nodeQueue"
  | "cronRead"
  | "cronWrite"
  | "cronRunHistory"
  | "channels"
  | "channelList"
  | "channelLogs"
  | "channelLogin"
  | "channelProvisioning"
  | "channelRemoval"
  | "gmailProvisioning"
  | "automationProvisioning"
  | "browserProfiles"
  | "voiceWake"
  | "talkCatalog"
  | "talkConfig"
  | "talkSession"
  | "talkClient"
  | "tts"
  | "environments"
  | "skills"
  | "updates";

export type OpenClawGatewayCompatibilityOperationDefinition = {
  id: OpenClawGatewayCompatibilityOperationId;
  label: string;
  methods: string[];
  events?: string[];
  fallbackAllowed?: boolean;
  recovery?: string;
  baseline?: "required" | "optional" | "experimental";
};

export const OPENCLAW_GATEWAY_COMPATIBILITY_OPERATIONS: OpenClawGatewayCompatibilityOperationDefinition[] = [
  { id: "health", label: "Gateway health", methods: ["health", "status"], baseline: "required" },
  { id: "diagnosticsStability", label: "Gateway diagnostics", methods: ["diagnostics.stability"], baseline: "optional" },
  { id: "gatewayIdentity", label: "Gateway identity", methods: ["gateway.identity.get"], baseline: "optional" },
  {
    id: "presence",
    label: "Presence and heartbeats",
    methods: ["system-presence", "last-heartbeat", "set-heartbeats"],
    events: ["presence", "tick", "health", "heartbeat", "shutdown"],
    baseline: "optional"
  },
  { id: "models", label: "Models List", methods: ["models.list", "models.authStatus"], baseline: "required" },
  {
    id: "modelAuthOrder",
    label: "Model auth order",
    methods: ["models.authOrder.set", "models.auth.order.set"],
    recovery: "Keep model selection explicit in AgentOS and update OpenClaw for native model auth order writes.",
    baseline: "experimental"
  },
  {
    id: "modelScan",
    label: "Model scan",
    methods: ["models.scan"],
    recovery: "Use explicit model refresh/discovery fallback only as recovery and update OpenClaw for native models.scan.",
    baseline: "experimental"
  },
  { id: "usageStatus", label: "Usage status", methods: ["usage.status"], baseline: "optional" },
  { id: "usageCost", label: "Usage cost", methods: ["usage.cost"], baseline: "optional" },
  {
    id: "sessionUsage",
    label: "Session usage",
    methods: ["sessions.usage", "sessions.usage.timeseries", "sessions.usage.logs"],
    baseline: "optional"
  },
  {
    id: "memoryDoctor",
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
    ],
    baseline: "optional"
  },
  { id: "logsTail", label: "Gateway logs", methods: ["logs.tail"], baseline: "required" },
  { id: "messaging", label: "Operator messaging", methods: ["send", "push.test"], baseline: "optional" },
  { id: "configSchemaLookup", label: "Config schema lookup", methods: ["config.schema.lookup", "config.schema"], baseline: "required" },
  { id: "configPatch", label: "Config patch", methods: ["config.patch", "config.apply", "config.set"], baseline: "required" },
  { id: "secrets", label: "Secret reload and resolution", methods: ["secrets.reload", "secrets.resolve"], baseline: "optional" },
  { id: "wizard", label: "Setup wizard", methods: ["wizard.start", "wizard.next", "wizard.status", "wizard.cancel"], baseline: "optional" },
  {
    id: "sessionLifecycle",
    label: "Session lifecycle",
    methods: ["sessions.list", "sessions.resolve", "sessions.create", "sessions.send", "sessions.steer", "sessions.abort"],
    baseline: "required"
  },
  {
    id: "sessionMutation",
    label: "Session mutation",
    methods: ["sessions.patch", "sessions.reset", "sessions.delete", "sessions.compact"],
    baseline: "optional"
  },
  {
    id: "sessionMessages",
    label: "Session message stream",
    methods: ["sessions.subscribe", "sessions.unsubscribe", "sessions.messages.subscribe", "sessions.messages.unsubscribe"],
    events: ["chat", "session.message", "session.operation", "session.tool", "sessions.changed"],
    baseline: "optional"
  },
  { id: "chatMessage", label: "Chat message lookup", methods: ["chat.message.get"], baseline: "optional" },
  { id: "agentCreate", label: "Agent creation", methods: ["agents.create"], baseline: "required" },
  { id: "agentUpdate", label: "Agent update", methods: ["agents.update"], fallbackAllowed: false, baseline: "required" },
  {
    id: "agentIdentity",
    label: "Agent identity sync",
    methods: ["agents.identity.set", "agents.setIdentity", "agents.set-identity"],
    recovery: "Continue with AgentOS config sync for native identity drift and update OpenClaw for agents.identity.set.",
    baseline: "experimental"
  },
  {
    id: "agentFiles",
    label: "Agent files",
    methods: ["agents.files.list", "agents.files.get", "agents.files.set"],
    baseline: "optional"
  },
  { id: "agentDelete", label: "Agent removal", methods: ["agents.delete"], baseline: "required" },
  { id: "missionDispatch", label: "Mission dispatch", methods: ["chat.send", "sessions.send"], baseline: "required" },
  {
    id: "missionStream",
    label: "Mission event stream",
    methods: ["sessions.subscribe", "sessions.messages.subscribe"],
    events: ["chat", "agent", "session.message", "session.tool"],
    baseline: "optional"
  },
  { id: "chatControl", label: "Chat control", methods: ["chat.abort", "chat.inject"], baseline: "optional" },
  { id: "agentWait", label: "Agent wait", methods: ["agent.wait"], baseline: "optional" },
  {
    id: "sessionHistory",
    label: "Session history",
    methods: ["chat.history", "sessions.preview", "sessions.get", "sessions.describe"],
    baseline: "optional"
  },
  {
    id: "taskEvents",
    label: "Task events",
    methods: ["tasks.list", "tasks.get"],
    events: ["session.operation", "sessions.changed", "task", "task.updated", "task.completed"],
    baseline: "optional"
  },
  {
    id: "taskAssign",
    label: "Task assignment",
    methods: ["tasks.assign"],
    fallbackAllowed: false,
    recovery: "Leave task assignment unavailable until OpenClaw exposes tasks.assign.",
    baseline: "experimental"
  },
  { id: "taskCancel", label: "Task cancellation", methods: ["tasks.cancel"], baseline: "optional" },
  {
    id: "artifacts",
    label: "Artifact sync",
    methods: ["artifacts.list", "artifacts.get", "artifacts.download"],
    events: ["artifact", "artifact.updated"],
    baseline: "optional"
  },
  { id: "artifactDownload", label: "Artifact download", methods: ["artifacts.download"], baseline: "optional" },
  { id: "runtimeSnapshot", label: "Runtime snapshot", methods: ["sessions.list", "tasks.list"], baseline: "required" },
  { id: "commands", label: "Command catalog", methods: ["commands.list"], fallbackAllowed: false, baseline: "optional" },
  { id: "tools", label: "Tool catalog", methods: ["tools.catalog", "tools.effective", "tools.invoke"], fallbackAllowed: false, baseline: "optional" },
  { id: "plugins", label: "Plugin catalog", methods: ["plugins.uiDescriptors", "plugins.list"], baseline: "optional" },
  {
    id: "execApprovals",
    label: "Execution approvals",
    methods: [
      "exec.approval.list",
      "exec.approval.get",
      "exec.approval.resolve",
      "exec.approvals.get",
      "exec.approvals.set"
    ],
    baseline: "optional"
  },
  {
    id: "pluginApprovals",
    label: "Plugin approvals",
    methods: [
      "plugin.approval.request",
      "plugin.approval.list",
      "plugin.approval.waitDecision",
      "plugin.approval.resolve"
    ],
    baseline: "optional"
  },
  { id: "devicePairList", label: "Device pairing list", methods: ["device.pair.list", "devices.list", "gateway.devices.list"], baseline: "optional" },
  {
    id: "deviceApproval",
    label: "Device access repair",
    methods: ["device.pair.approve", "device.pair.reject", "device.pair.remove", "devices.approve", "gateway.devices.approve"],
    baseline: "optional"
  },
  { id: "deviceToken", label: "Device token lifecycle", methods: ["device.token.rotate", "device.token.revoke"], baseline: "optional" },
  {
    id: "nodePairing",
    label: "Node pairing",
    methods: ["node.pair.request", "node.pair.list", "node.pair.approve", "node.pair.reject", "node.pair.remove", "node.pair.verify"],
    events: ["node.pair.requested", "node.pair.resolved"],
    baseline: "optional"
  },
  { id: "nodePresence", label: "Node presence", methods: ["node.list", "node.describe", "node.rename"], events: ["node.event"], baseline: "optional" },
  { id: "nodeInvoke", label: "Node invoke", methods: ["node.invoke", "node.invoke.result"], baseline: "optional" },
  {
    id: "nodeQueue",
    label: "Node pending queue",
    methods: ["node.pending.pull", "node.pending.ack", "node.pending.enqueue", "node.pending.drain"],
    baseline: "optional"
  },
  { id: "cronRead", label: "Automation status", methods: ["cron.list", "cron.status"], baseline: "optional" },
  { id: "cronWrite", label: "Automation writes", methods: ["cron.get", "cron.add", "cron.update", "cron.remove"], baseline: "optional" },
  { id: "cronRunHistory", label: "Automation run history", methods: ["cron.run", "cron.runs", "wake"], events: ["cron"], baseline: "optional" },
  { id: "channels", label: "Channel status", methods: ["channels.status"], baseline: "required" },
  { id: "channelList", label: "Channel list", methods: ["channels.status"], baseline: "optional" },
  {
    id: "channelLogs",
    label: "Channel logs",
    methods: ["channels.logs"],
    recovery: "Use visible CLI fallback only for channel log recovery and update OpenClaw for native channels.logs.",
    baseline: "experimental"
  },
  { id: "channelLogin", label: "Channel and web login", methods: ["channels.logout", "web.login.start", "web.login.wait"], baseline: "optional" },
  {
    id: "channelProvisioning",
    label: "Channel provisioning",
    methods: ["channels.add", "channels.create", "channels.configure"],
    recovery: "Keep provisioning marked limited unless a native channel creation method or explicit CLI fallback succeeds.",
    baseline: "experimental"
  },
  {
    id: "channelRemoval",
    label: "Channel removal",
    methods: ["channels.remove", "channels.delete"],
    recovery: "Keep removal marked limited unless a native channel removal method or explicit CLI fallback succeeds.",
    baseline: "experimental"
  },
  {
    id: "gmailProvisioning",
    label: "Gmail webhook setup",
    methods: ["webhooks.gmail.setup", "gmail.setup"],
    recovery: "Keep Gmail webhook setup unavailable or explicit CLI-only until OpenClaw exposes native webhook setup.",
    baseline: "experimental"
  },
  { id: "automationProvisioning", label: "Automation provisioning", methods: ["cron.add", "cron.create"], baseline: "experimental" },
  { id: "browserProfiles", label: "Browser profiles", methods: ["browser.request"], fallbackAllowed: false, baseline: "experimental" },
  { id: "voiceWake", label: "Voice wake", methods: ["voicewake.get", "voicewake.set"], events: ["voicewake.changed"], baseline: "optional" },
  { id: "talkCatalog", label: "Talk catalog", methods: ["talk.catalog"], baseline: "optional" },
  { id: "talkConfig", label: "Talk config", methods: ["talk.config"], baseline: "optional" },
  {
    id: "talkSession",
    label: "Talk session control",
    methods: [
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
      "talk.speak"
    ],
    events: ["talk.event"],
    baseline: "optional"
  },
  { id: "talkClient", label: "Talk client control", methods: ["talk.client.create", "talk.client.toolCall", "talk.client.steer"], baseline: "optional" },
  {
    id: "tts",
    label: "Text to speech",
    methods: ["tts.status", "tts.providers", "tts.enable", "tts.disable", "tts.setProvider", "tts.convert"],
    baseline: "optional"
  },
  { id: "environments", label: "Environments", methods: ["environments.list", "environments.status"], baseline: "optional" },
  { id: "skills", label: "Skill status", methods: ["skills.status"], baseline: "optional" },
  { id: "updates", label: "Update status", methods: ["update.status", "update.run", "status"], baseline: "optional" }
];

export const OPENCLAW_GATEWAY_BASELINE_VERSION = OPENCLAW_SUPPORTED_BASELINE_VERSION;

export const OPENCLAW_GATEWAY_BASELINE_PROTOCOL_VERSION = 4;

export const OPENCLAW_2026_6_8_REQUIRED_GATEWAY_METHODS = [
  "health",
  "status",
  "update.status",
  "models.list",
  "agents.list",
  "agents.create",
  "agents.update",
  "agents.delete",
  "sessions.list",
  "sessions.preview",
  "chat.send",
  "config.get",
  "config.set",
  "config.schema",
  "config.schema.lookup",
  "config.patch",
  "config.apply",
  "channels.status",
  "logs.tail"
] as const;

export const OPENCLAW_2026_6_8_OPTIONAL_GATEWAY_METHODS = [
  "agent.identity.get",
  "agent.wait",
  "agents.files.list",
  "agents.files.get",
  "agents.files.set",
  "artifacts.download",
  "artifacts.get",
  "artifacts.list",
  "chat.message.get",
  "chat.abort",
  "chat.history",
  "chat.inject",
  "channels.logout",
  "commands.list",
  "cron.get",
  "cron.add",
  "cron.list",
  "cron.remove",
  "cron.run",
  "cron.runs",
  "cron.status",
  "cron.update",
  "diagnostics.stability",
  "device.token.rotate",
  "device.token.revoke",
  "device.pair.list",
  "device.pair.approve",
  "device.pair.reject",
  "device.pair.remove",
  "doctor.memory.status",
  "doctor.memory.dreamDiary",
  "doctor.memory.backfillDreamDiary",
  "doctor.memory.resetDreamDiary",
  "doctor.memory.resetGroundedShortTerm",
  "doctor.memory.repairDreamingArtifacts",
  "doctor.memory.dedupeDreamDiary",
  "doctor.memory.remHarness",
  "environments.list",
  "environments.status",
  "exec.approval.get",
  "exec.approval.list",
  "exec.approval.request",
  "exec.approval.resolve",
  "exec.approval.waitDecision",
  "exec.approvals.get",
  "exec.approvals.node.get",
  "exec.approvals.node.set",
  "exec.approvals.set",
  "gateway.identity.get",
  "last-heartbeat",
  "node.describe",
  "node.event",
  "node.invoke",
  "node.invoke.result",
  "node.list",
  "node.pending.ack",
  "node.pending.drain",
  "node.pending.enqueue",
  "node.pending.pull",
  "node.pair.approve",
  "node.pair.list",
  "node.pair.reject",
  "node.pair.remove",
  "node.pair.request",
  "node.pair.verify",
  "node.rename",
  "plugins.uiDescriptors",
  "plugins.list",
  "plugin.approval.list",
  "plugin.approval.request",
  "plugin.approval.resolve",
  "plugin.approval.waitDecision",
  "push.test",
  "secrets.reload",
  "secrets.resolve",
  "send",
  "set-heartbeats",
  "sessions.abort",
  "sessions.compact",
  "sessions.create",
  "sessions.delete",
  "sessions.describe",
  "sessions.get",
  "sessions.messages.subscribe",
  "sessions.messages.unsubscribe",
  "sessions.patch",
  "sessions.reset",
  "sessions.resolve",
  "sessions.steer",
  "sessions.subscribe",
  "sessions.unsubscribe",
  "sessions.usage",
  "sessions.usage.logs",
  "sessions.usage.timeseries",
  "skills.detail",
  "skills.install",
  "skills.search",
  "skills.status",
  "skills.update",
  "system-presence",
  "tasks.cancel",
  "tasks.get",
  "tasks.list",
  "talk.catalog",
  "talk.client.create",
  "talk.client.steer",
  "talk.client.toolCall",
  "talk.config",
  "talk.event",
  "talk.mode",
  "talk.session.appendAudio",
  "talk.session.cancelOutput",
  "talk.session.cancelTurn",
  "talk.session.close",
  "talk.session.create",
  "talk.session.endTurn",
  "talk.session.join",
  "talk.session.startTurn",
  "talk.session.steer",
  "talk.session.submitToolResult",
  "talk.speak",
  "tts.convert",
  "tts.disable",
  "tts.enable",
  "tts.providers",
  "tts.setProvider",
  "tts.status",
  "tools.catalog",
  "tools.effective",
  "tools.invoke",
  "update.run",
  "usage.cost",
  "usage.status",
  "voicewake.get",
  "voicewake.set",
  "web.login.start",
  "web.login.wait",
  "wake",
  "wizard.cancel",
  "wizard.next",
  "wizard.start",
  "wizard.status"
] as const;

export const OPENCLAW_EXPERIMENTAL_GATEWAY_METHODS = [
  "artifacts.put",
  "artifacts.delete",
  "channels.list",
  "channels.start",
  "channels.stop",
  "cron.create",
  "devices.list",
  "gateway.restart.preflight",
  "gateway.restart.request",
  "models.authStatus",
  "models.scan",
  "tasks.assign",
  "models.authOrder.set",
  "models.auth.order.set",
  "agents.identity.set",
  "agents.setIdentity",
  "agents.set-identity",
  "channels.logs",
  "channels.add",
  "channels.create",
  "channels.configure",
  "channels.remove",
  "channels.delete",
  "webhooks.gmail.setup",
  "gmail.setup",
  "browser.request"
] as const;

const additionalGatewayFirstMethods = [
  ...OPENCLAW_2026_6_8_REQUIRED_GATEWAY_METHODS,
  ...OPENCLAW_2026_6_8_OPTIONAL_GATEWAY_METHODS,
  ...OPENCLAW_EXPERIMENTAL_GATEWAY_METHODS
];

export const OPENCLAW_KNOWN_GATEWAY_FIRST_METHODS = Array.from(
  new Set([
    ...OPENCLAW_GATEWAY_COMPATIBILITY_OPERATIONS.flatMap((operation) => operation.methods),
    ...additionalGatewayFirstMethods
  ])
).sort();

export const OPENCLAW_GATEWAY_BASELINE_METHODS = Array.from(
  new Set([
    ...OPENCLAW_2026_6_8_REQUIRED_GATEWAY_METHODS,
    ...OPENCLAW_2026_6_8_OPTIONAL_GATEWAY_METHODS
  ])
).sort();

export const OPENCLAW_GATEWAY_BASELINE_REQUIRED_METHODS = Array.from(
  new Set(OPENCLAW_2026_6_8_REQUIRED_GATEWAY_METHODS)
).sort();

export const OPENCLAW_GATEWAY_BASELINE_OPTIONAL_METHODS = Array.from(
  new Set(OPENCLAW_2026_6_8_OPTIONAL_GATEWAY_METHODS)
).sort();

export const OPENCLAW_GATEWAY_EXPERIMENTAL_METHODS = Array.from(
  new Set(OPENCLAW_EXPERIMENTAL_GATEWAY_METHODS)
).sort();

const operationDefinitionsById = new Map(
  OPENCLAW_GATEWAY_COMPATIBILITY_OPERATIONS.map((operation) => [operation.id, operation])
);

const operationDefinitionsByMethod = new Map(
  OPENCLAW_GATEWAY_COMPATIBILITY_OPERATIONS.flatMap((operation) =>
    operation.methods.map((method) => [method, operation] as const)
  )
);

export function getOpenClawGatewayCompatibilityOperation(
  operationId: OpenClawGatewayCompatibilityOperationId
) {
  const operation = operationDefinitionsById.get(operationId);

  if (!operation) {
    throw new Error(`Unknown OpenClaw Gateway compatibility operation: ${operationId}`);
  }

  return operation;
}

export function getOpenClawGatewayMethodCandidates(
  operationId: OpenClawGatewayCompatibilityOperationId
) {
  return getOpenClawGatewayCompatibilityOperation(operationId).methods;
}

export function getOpenClawGatewayOperationLabel(operationIdOrMethod: string) {
  return (
    operationDefinitionsById.get(operationIdOrMethod as OpenClawGatewayCompatibilityOperationId)?.label ??
    operationDefinitionsByMethod.get(operationIdOrMethod)?.label ??
    titleizeGatewayOperation(operationIdOrMethod)
  );
}

function titleizeGatewayOperation(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase()) || "Gateway operation";
}

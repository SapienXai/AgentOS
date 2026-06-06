import { OPENCLAW_SUPPORTED_BASELINE_VERSION } from "@/lib/openclaw/versions";

export type OpenClawGatewayCompatibilityOperationId =
  | "health"
  | "models"
  | "modelAuthOrder"
  | "modelScan"
  | "logsTail"
  | "configSchemaLookup"
  | "configPatch"
  | "sessionLifecycle"
  | "agentCreate"
  | "agentUpdate"
  | "agentIdentity"
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
  | "runtimeSnapshot"
  | "tools"
  | "plugins"
  | "execApprovals"
  | "devicePairList"
  | "deviceApproval"
  | "cronRead"
  | "channels"
  | "channelList"
  | "channelLogs"
  | "channelProvisioning"
  | "channelRemoval"
  | "gmailProvisioning"
  | "automationProvisioning"
  | "browserProfiles"
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
    baseline: "optional"
  },
  { id: "logsTail", label: "Gateway logs", methods: ["logs.tail"], baseline: "required" },
  { id: "configSchemaLookup", label: "Config schema lookup", methods: ["config.schema.lookup", "config.schema"], baseline: "required" },
  { id: "configPatch", label: "Config patch", methods: ["config.patch", "config.apply", "config.set"], baseline: "required" },
  { id: "sessionLifecycle", label: "Session lifecycle", methods: ["sessions.create", "sessions.patch", "sessions.steer"], baseline: "optional" },
  { id: "agentCreate", label: "Agent creation", methods: ["agents.create"], baseline: "required" },
  { id: "agentUpdate", label: "Agent update", methods: ["agents.update"], fallbackAllowed: false, baseline: "required" },
  {
    id: "agentIdentity",
    label: "Agent identity sync",
    methods: ["agents.identity.set", "agents.setIdentity", "agents.set-identity"],
    recovery: "Continue with AgentOS config sync for native identity drift and update OpenClaw for agents.identity.set.",
    baseline: "experimental"
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
  { id: "sessionHistory", label: "Session history", methods: ["chat.history", "sessions.preview", "sessions.get", "sessions.describe"], baseline: "optional" },
  {
    id: "taskEvents",
    label: "Task events",
    methods: ["tasks.subscribe", "tasks.get", "tasks.list"],
    events: ["task", "task.updated", "task.completed"],
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
  { id: "runtimeSnapshot", label: "Runtime snapshot", methods: ["sessions.list", "tasks.list"], baseline: "required" },
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
  { id: "devicePairList", label: "Device pairing list", methods: ["device.pair.list", "devices.list", "gateway.devices.list"], baseline: "optional" },
  { id: "deviceApproval", label: "Device access repair", methods: ["device.pair.approve", "devices.approve", "gateway.devices.approve"], baseline: "optional" },
  { id: "cronRead", label: "Automation status", methods: ["cron.list", "cron.status"], baseline: "optional" },
  { id: "channels", label: "Channel status", methods: ["channels.status"], baseline: "required" },
  { id: "channelList", label: "Channel list", methods: ["channels.list", "channels.status"], baseline: "optional" },
  {
    id: "channelLogs",
    label: "Channel logs",
    methods: ["channels.logs"],
    recovery: "Use visible CLI fallback only for channel log recovery and update OpenClaw for native channels.logs.",
    baseline: "experimental"
  },
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
  { id: "skills", label: "Skill status", methods: ["skills.status"], baseline: "optional" },
  { id: "updates", label: "Update status", methods: ["update.status", "update.run", "status"], baseline: "optional" }
];

export const OPENCLAW_GATEWAY_BASELINE_VERSION = OPENCLAW_SUPPORTED_BASELINE_VERSION;

export const OPENCLAW_GATEWAY_BASELINE_PROTOCOL_VERSION = 4;

export const OPENCLAW_2026_6_1_REQUIRED_GATEWAY_METHODS = [
  "health",
  "status",
  "update.status",
  "models.list",
  "models.authStatus",
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

export const OPENCLAW_2026_6_1_OPTIONAL_GATEWAY_METHODS = [
  "agent.identity.get",
  "agent.wait",
  "artifacts.download",
  "artifacts.get",
  "artifacts.list",
  "chat.abort",
  "chat.history",
  "chat.inject",
  "channels.logout",
  "channels.list",
  "channels.start",
  "channels.stop",
  "cron.list",
  "cron.status",
  "devices.list",
  "device.pair.list",
  "device.pair.approve",
  "device.pair.reject",
  "device.pair.remove",
  "exec.approval.get",
  "exec.approval.list",
  "exec.approval.request",
  "exec.approval.resolve",
  "exec.approval.waitDecision",
  "plugins.uiDescriptors",
  "plugins.list",
  "models.scan",
  "sessions.abort",
  "sessions.create",
  "sessions.describe",
  "sessions.get",
  "sessions.messages.subscribe",
  "sessions.patch",
  "sessions.resolve",
  "sessions.steer",
  "sessions.subscribe",
  "skills.detail",
  "skills.install",
  "skills.search",
  "skills.status",
  "skills.update",
  "tasks.cancel",
  "tasks.get",
  "tasks.list",
  "tasks.subscribe",
  "tools.catalog",
  "tools.effective",
  "tools.invoke",
  "update.run"
] as const;

export const OPENCLAW_EXPERIMENTAL_GATEWAY_METHODS = [
  "diagnostics.stability",
  "agents.files.list",
  "agents.files.get",
  "agents.files.set",
  "plugin.approval.list",
  "plugin.approval.resolve",
  "environment.list",
  "environment.get",
  "environment.create",
  "environment.update",
  "environment.delete",
  "gateway.restart.preflight",
  "gateway.restart.request",
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
  "cron.add",
  "cron.create",
  "browser.request"
] as const;

const additionalGatewayFirstMethods = [
  ...OPENCLAW_2026_6_1_REQUIRED_GATEWAY_METHODS,
  ...OPENCLAW_2026_6_1_OPTIONAL_GATEWAY_METHODS,
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
    ...OPENCLAW_2026_6_1_REQUIRED_GATEWAY_METHODS,
    ...OPENCLAW_2026_6_1_OPTIONAL_GATEWAY_METHODS
  ])
).sort();

export const OPENCLAW_GATEWAY_BASELINE_REQUIRED_METHODS = Array.from(
  new Set(OPENCLAW_2026_6_1_REQUIRED_GATEWAY_METHODS)
).sort();

export const OPENCLAW_GATEWAY_BASELINE_OPTIONAL_METHODS = Array.from(
  new Set(OPENCLAW_2026_6_1_OPTIONAL_GATEWAY_METHODS)
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

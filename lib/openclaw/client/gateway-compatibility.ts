export type OpenClawGatewayCompatibilityOperationId =
  | "health"
  | "modelAuthOrder"
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
  | "taskCancel"
  | "artifacts"
  | "runtimeSnapshot"
  | "tools"
  | "execApprovals"
  | "devicePairList"
  | "deviceApproval"
  | "cronRead"
  | "channels"
  | "channelLogs"
  | "channelProvisioning"
  | "channelRemoval"
  | "gmailProvisioning"
  | "automationProvisioning"
  | "skills"
  | "updates";

export type OpenClawGatewayCompatibilityOperationDefinition = {
  id: OpenClawGatewayCompatibilityOperationId;
  label: string;
  methods: string[];
  events?: string[];
  fallbackAllowed?: boolean;
};

export const OPENCLAW_GATEWAY_COMPATIBILITY_OPERATIONS: OpenClawGatewayCompatibilityOperationDefinition[] = [
  { id: "health", label: "Gateway health", methods: ["health", "status"] },
  { id: "modelAuthOrder", label: "Model auth order", methods: ["models.authOrder.set", "models.auth.order.set"] },
  { id: "logsTail", label: "Gateway logs", methods: ["logs.tail"] },
  { id: "configSchemaLookup", label: "Config schema lookup", methods: ["config.schema.lookup", "config.schema"] },
  { id: "configPatch", label: "Config patch", methods: ["config.patch", "config.apply", "config.set"] },
  { id: "sessionLifecycle", label: "Session lifecycle", methods: ["sessions.create", "sessions.patch", "sessions.steer"] },
  { id: "agentCreate", label: "Agent creation", methods: ["agents.create"] },
  { id: "agentUpdate", label: "Agent update", methods: ["agents.update"] },
  { id: "agentIdentity", label: "Agent identity sync", methods: ["agents.identity.set", "agents.setIdentity", "agents.set-identity"] },
  { id: "agentDelete", label: "Agent removal", methods: ["agents.delete"] },
  { id: "missionDispatch", label: "Mission dispatch", methods: ["chat.send", "sessions.send"] },
  {
    id: "missionStream",
    label: "Mission event stream",
    methods: ["sessions.subscribe", "sessions.messages.subscribe"],
    events: ["chat", "agent", "session.message", "session.tool"]
  },
  { id: "chatControl", label: "Chat control", methods: ["chat.abort", "chat.inject"] },
  { id: "agentWait", label: "Agent wait", methods: ["agent.wait"] },
  { id: "sessionHistory", label: "Session history", methods: ["sessions.describe", "sessions.history", "sessions.export"] },
  {
    id: "taskEvents",
    label: "Task events",
    methods: ["tasks.subscribe", "tasks.get", "tasks.list"],
    events: ["task", "task.updated", "task.completed"]
  },
  { id: "taskCancel", label: "Task cancellation", methods: ["tasks.cancel"] },
  {
    id: "artifacts",
    label: "Artifact sync",
    methods: ["artifacts.list", "artifacts.get", "artifacts.put", "artifacts.delete"],
    events: ["artifact", "artifact.updated"]
  },
  { id: "runtimeSnapshot", label: "Runtime snapshot", methods: ["runtime.snapshot"] },
  { id: "tools", label: "Tool catalog", methods: ["tools.catalog", "tools.effective", "tools.invoke"] },
  {
    id: "execApprovals",
    label: "Execution approvals",
    methods: [
      "exec.approval.list",
      "exec.approval.get",
      "exec.approval.resolve",
      "exec.approvals.get",
      "exec.approvals.set"
    ]
  },
  { id: "devicePairList", label: "Device pairing list", methods: ["device.pair.list", "devices.list", "gateway.devices.list"] },
  { id: "deviceApproval", label: "Device access repair", methods: ["device.pair.approve", "devices.approve", "gateway.devices.approve"] },
  { id: "cronRead", label: "Automation status", methods: ["cron.list", "cron.status"] },
  { id: "channels", label: "Channel status", methods: ["channels.status"] },
  { id: "channelLogs", label: "Channel logs", methods: ["channels.logs"] },
  { id: "channelProvisioning", label: "Channel provisioning", methods: ["channels.add", "channels.create", "channels.configure"] },
  { id: "channelRemoval", label: "Channel removal", methods: ["channels.remove", "channels.delete"] },
  { id: "gmailProvisioning", label: "Gmail webhook setup", methods: ["webhooks.gmail.setup", "gmail.setup"] },
  { id: "automationProvisioning", label: "Automation provisioning", methods: ["cron.add", "cron.create"] },
  { id: "skills", label: "Skill status", methods: ["skills.status"] },
  { id: "updates", label: "Update status", methods: ["update.status", "update.run", "status"] }
];

const additionalGatewayFirstMethods = [
  "diagnostics.stability",
  "models.list",
  "models.authStatus",
  "agents.list",
  "agents.files.list",
  "agents.files.get",
  "agents.files.set",
  "sessions.list",
  "sessions.create",
  "sessions.patch",
  "sessions.steer",
  "sessions.preview",
  "sessions.resolve",
  "sessions.abort",
  "chat.history",
  "chat.abort",
  "chat.inject",
  "agent.wait",
  "tasks.cancel",
  "config.get",
  "channels.start",
  "channels.stop",
  "channels.logout",
  "skills.search",
  "skills.detail",
  "skills.install",
  "skills.update",
  "plugins.uiDescriptors",
  "exec.approval.request",
  "exec.approval.waitDecision",
  "plugin.approval.list",
  "plugin.approval.resolve",
  "environment.list",
  "environment.get",
  "environment.create",
  "environment.update",
  "environment.delete",
  "gateway.restart.preflight",
  "gateway.restart.request"
];

export const OPENCLAW_KNOWN_GATEWAY_FIRST_METHODS = Array.from(
  new Set([
    ...OPENCLAW_GATEWAY_COMPATIBILITY_OPERATIONS.flatMap((operation) => operation.methods),
    ...additionalGatewayFirstMethods
  ])
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

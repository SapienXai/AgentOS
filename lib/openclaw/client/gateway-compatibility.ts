export type OpenClawGatewayCompatibilityOperationId =
  | "health"
  | "modelAuthOrder"
  | "logsTail"
  | "configSchemaLookup"
  | "configPatch"
  | "agentCreate"
  | "agentUpdate"
  | "agentDelete"
  | "missionDispatch"
  | "missionStream"
  | "sessionHistory"
  | "taskEvents"
  | "artifacts"
  | "runtimeSnapshot"
  | "tools"
  | "execApprovals"
  | "cronRead"
  | "channels"
  | "channelLogs"
  | "channelProvisioning"
  | "automationProvisioning"
  | "skills"
  | "updates";

export type OpenClawGatewayCompatibilityOperationDefinition = {
  id: OpenClawGatewayCompatibilityOperationId;
  methods: string[];
  events?: string[];
  fallbackAllowed?: boolean;
};

export const OPENCLAW_GATEWAY_COMPATIBILITY_OPERATIONS: OpenClawGatewayCompatibilityOperationDefinition[] = [
  { id: "health", methods: ["health", "status"] },
  { id: "modelAuthOrder", methods: ["models.authOrder.set", "models.auth.order.set"] },
  { id: "logsTail", methods: ["logs.tail"] },
  { id: "configSchemaLookup", methods: ["config.schema.lookup", "config.schema"] },
  { id: "configPatch", methods: ["config.patch", "config.apply", "config.set"] },
  { id: "agentCreate", methods: ["agents.create"] },
  { id: "agentUpdate", methods: ["agents.update"] },
  { id: "agentDelete", methods: ["agents.delete"] },
  { id: "missionDispatch", methods: ["chat.send", "sessions.send"] },
  {
    id: "missionStream",
    methods: ["sessions.subscribe", "sessions.messages.subscribe"],
    events: ["chat", "agent", "session.message", "session.tool"]
  },
  { id: "sessionHistory", methods: ["sessions.describe", "sessions.history", "sessions.export"] },
  {
    id: "taskEvents",
    methods: ["tasks.subscribe", "tasks.get", "tasks.list"],
    events: ["task", "task.updated", "task.completed"]
  },
  {
    id: "artifacts",
    methods: ["artifacts.list", "artifacts.get", "artifacts.put", "artifacts.delete"],
    events: ["artifact", "artifact.updated"]
  },
  { id: "runtimeSnapshot", methods: ["runtime.snapshot"] },
  { id: "tools", methods: ["tools.catalog", "tools.effective", "tools.invoke"] },
  {
    id: "execApprovals",
    methods: [
      "exec.approval.list",
      "exec.approval.get",
      "exec.approval.resolve",
      "exec.approvals.get",
      "exec.approvals.set"
    ]
  },
  { id: "cronRead", methods: ["cron.list", "cron.status"] },
  { id: "channels", methods: ["channels.status"] },
  { id: "channelLogs", methods: ["channels.logs"] },
  { id: "channelProvisioning", methods: ["channels.add", "channels.create", "channels.configure"] },
  { id: "automationProvisioning", methods: ["cron.add", "cron.create"] },
  { id: "skills", methods: ["skills.status"] },
  { id: "updates", methods: ["update.status", "update.run", "status"] }
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
  "sessions.preview",
  "sessions.resolve",
  "sessions.abort",
  "chat.history",
  "chat.abort",
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

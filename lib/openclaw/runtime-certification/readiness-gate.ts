import {
  MAX_CONTROL_PROTOCOL_VERSION,
  MIN_CONTROL_PROTOCOL_VERSION
} from "@/lib/openclaw/client/native-ws-gateway-types";
import type {
  OpenClawRuntimeCertificationReport,
  OpenClawRuntimeMigrationReadiness,
  OpenClawRuntimeOperationEvidence
} from "@/lib/openclaw/runtime-certification/types";

export const OPENCLAW_RUNTIME_MIGRATION_CORE_OPERATION_IDS = [
  "sessions.create",
  "sessions.patch",
  "sessions.delete",
  "chat.send",
  "chat.streaming",
  "session.continuity",
  "agents.create",
  "agents.update",
  "agents.delete",
  "config.get",
  "config.patch",
  "gateway.restart"
] as const;

export function evaluateOpenClawRuntimeMigrationReadiness(input: {
  runtimeReport: OpenClawRuntimeCertificationReport;
  staticTargetVersion: string;
  persistenceHealthy?: boolean;
}): OpenClawRuntimeMigrationReadiness {
  const { runtimeReport } = input;
  const targetVersionMatched = runtimeReport.targetVersion === input.staticTargetVersion;
  const installedVersionMatched = runtimeReport.installedVersion === input.staticTargetVersion;
  const protocolSupported = typeof runtimeReport.protocolVersion === "number" &&
    runtimeReport.protocolVersion >= MIN_CONTROL_PROTOCOL_VERSION &&
    runtimeReport.protocolVersion <= MAX_CONTROL_PROTOCOL_VERSION;
  const handshakeValid = runtimeReport.connectionStatus === "connected" &&
    runtimeReport.role === "operator" &&
    runtimeReport.scopes.includes("operator.read") &&
    runtimeReport.scopes.includes("operator.write");
  const persistenceHealthy = input.persistenceHealthy ?? runtimeReport.persistence?.status === "healthy";
  const byOperation = new Map(runtimeReport.operations.map((operation) => [operation.operationId, operation]));
  const coreOperations = OPENCLAW_RUNTIME_MIGRATION_CORE_OPERATION_IDS.map((operationId) => {
    const operation = byOperation.get(operationId);
    return {
      operationId,
      outcome: operation?.outcome ?? ("missing" as const),
      reason: operation?.reason ?? "No exact runtime operation evidence was recorded."
    };
  });

  const blockers: string[] = [];
  if (!targetVersionMatched) blockers.push("Static and runtime certification target versions do not match.");
  if (!installedVersionMatched) blockers.push("The connected Gateway installed version does not match the requested target.");
  if (!protocolSupported) blockers.push(`The Gateway protocol is outside the supported range ${MIN_CONTROL_PROTOCOL_VERSION}-${MAX_CONTROL_PROTOCOL_VERSION}.`);
  if (!handshakeValid) blockers.push("The native handshake does not prove an authenticated operator with read and write scopes.");
  if (!persistenceHealthy) blockers.push("Runtime persistence health was not proven.");
  for (const operation of coreOperations) {
    if (operation.outcome !== "certified") {
      blockers.push(`Core operation ${operation.operationId} is ${operation.outcome}: ${operation.reason}`);
    }
  }

  return {
    readyForMigrationEngine: blockers.length === 0,
    targetVersionMatched,
    installedVersionMatched,
    protocolSupported,
    handshakeValid,
    persistenceHealthy,
    requiredOperationIds: [...OPENCLAW_RUNTIME_MIGRATION_CORE_OPERATION_IDS],
    coreOperations,
    blockers,
    optionalOperations: selectOperations(runtimeReport.operations, "optional"),
    experimentalOperations: selectOperations(runtimeReport.operations, "experimental")
  };
}

function selectOperations(
  operations: OpenClawRuntimeOperationEvidence[],
  requirementLevel: "optional" | "experimental"
) {
  return operations
    .filter((operation) => operation.requirementLevel === requirementLevel)
    .map((operation) => ({ operationId: operation.operationId, outcome: operation.outcome }));
}

import type {
  OpenClawCompatibilityLabAreaDefinition,
  OpenClawCompatibilityLabAreaId
} from "@/lib/openclaw/compatibility-lab/types";

export const OPENCLAW_COMPATIBILITY_LAB_AREAS: Record<
  OpenClawCompatibilityLabAreaId,
  OpenClawCompatibilityLabAreaDefinition
> = {
  "manifest-policy": {
    id: "manifest-policy",
    name: "Manifest and certification policy",
    affectedAgentOsFiles: [
      "lib/openclaw/update-compatibility.ts",
      "lib/openclaw/versions.ts",
      "components/mission-control/settings-control-center.tsx"
    ],
    suggestedFixScope: "Adjust compatibility policy only after evidence proves the target is safe; never auto-certify unknown versions.",
    recommendedNextAction: "Keep the target in needs-certification state until lab evidence and manifest review agree.",
    failingCommandOrTest: "pnpm test -- tests/openclaw-update-compatibility.test.ts",
    regressionTestsToAddOrUpdate: ["tests/openclaw-update-compatibility.test.ts"]
  },
  "gateway-protocol": {
    id: "gateway-protocol",
    name: "Gateway protocol and lifecycle",
    affectedAgentOsFiles: [
      "lib/openclaw/client/*",
      "lib/openclaw/adapter/*",
      "lib/openclaw/application/gateway-service.ts"
    ],
    suggestedFixScope: "Restore Gateway protocol compatibility through the client/adapter boundary without adding direct UI Gateway calls.",
    recommendedNextAction: "Repair protocol, auth, or lifecycle handling before attempting certification.",
    failingCommandOrTest: "pnpm test -- tests/openclaw-gateway-first-contract.test.ts tests/openclaw-native-ws-gateway-client.test.ts",
    regressionTestsToAddOrUpdate: [
      "tests/openclaw-gateway-first-contract.test.ts",
      "tests/openclaw-native-ws-gateway-client.test.ts"
    ]
  },
  "native-rpc": {
    id: "native-rpc",
    name: "Native Gateway RPC coverage",
    affectedAgentOsFiles: [
      "lib/openclaw/client/gateway-compatibility.ts",
      "lib/openclaw/application/capability-matrix-service.ts",
      "lib/openclaw/compat/*"
    ],
    suggestedFixScope: "Update operation aliases, capability detection, or adapter fallback policy for changed RPC coverage.",
    recommendedNextAction: "Resolve required native RPC regressions or mark unsupported surfaces honestly.",
    failingCommandOrTest: "pnpm test -- tests/openclaw-gateway-first-contract.test.ts tests/openclaw-compat-report.test.ts",
    regressionTestsToAddOrUpdate: [
      "tests/openclaw-gateway-first-contract.test.ts",
      "tests/openclaw-compat-report.test.ts"
    ]
  },
  "payload-shapes": {
    id: "payload-shapes",
    name: "Gateway payload shapes",
    affectedAgentOsFiles: [
      "lib/openclaw/client/native-ws-gateway-payloads.ts",
      "lib/openclaw/adapter/gateway-payloads.ts",
      "lib/openclaw/client/types.ts"
    ],
    suggestedFixScope: "Update parsers, normalizers, and domain adapters for changed OpenClaw payload shapes.",
    recommendedNextAction: "Compare expected and actual payload shapes, then add parser/normalizer regression coverage.",
    failingCommandOrTest: "pnpm test -- tests/openclaw-compat-report.test.ts tests/openclaw-native-ws-gateway-client.test.ts",
    regressionTestsToAddOrUpdate: [
      "tests/openclaw-compat-report.test.ts",
      "tests/openclaw-native-ws-gateway-client.test.ts"
    ]
  },
  "models-providers": {
    id: "models-providers",
    name: "Model and provider discovery",
    affectedAgentOsFiles: [
      "lib/openclaw/application/model-provider-state-service.ts",
      "lib/openclaw/model-provider-adapters.ts",
      "lib/openclaw/model-provider-registry.ts"
    ],
    suggestedFixScope: "Restore model/provider discovery and readiness using OpenClaw data, not local mock state.",
    recommendedNextAction: "Repair model/provider payload handling before dispatching missions through the target version.",
    failingCommandOrTest: "pnpm test -- tests/openclaw-model-provider-state-service.test.ts tests/openclaw-compatibility-smoke.test.ts",
    regressionTestsToAddOrUpdate: [
      "tests/openclaw-model-provider-state-service.test.ts",
      "tests/openclaw-compatibility-smoke.test.ts"
    ]
  },
  "sessions-tasks-agents": {
    id: "sessions-tasks-agents",
    name: "Sessions, tasks, and agents",
    affectedAgentOsFiles: [
      "lib/openclaw/application/runtime-service.ts",
      "lib/openclaw/application/task-control-service.ts",
      "lib/openclaw/application/agent-service.ts",
      "lib/openclaw/domains/*"
    ],
    suggestedFixScope: "Restore normalized sessions/tasks/agents behavior through application services and domain mappers.",
    recommendedNextAction: "Fix runtime visibility or lifecycle regressions before certifying.",
    failingCommandOrTest: "pnpm test -- tests/openclaw-runtime-state-service.test.ts tests/openclaw-agent-service.test.ts tests/openclaw-application-service-compat.test.ts",
    regressionTestsToAddOrUpdate: [
      "tests/openclaw-runtime-state-service.test.ts",
      "tests/openclaw-agent-service.test.ts",
      "tests/openclaw-application-service-compat.test.ts"
    ]
  },
  "config-patching": {
    id: "config-patching",
    name: "Config schema and patching",
    affectedAgentOsFiles: [
      "lib/openclaw/application/settings-service.ts",
      "lib/openclaw/application/config-pacing-service.ts",
      "lib/openclaw/update-rollback.ts"
    ],
    suggestedFixScope: "Restore config read/schema/patch behavior and keep unsafe config mutations blocked or explicit.",
    recommendedNextAction: "Treat missing config patch support as a certification blocker unless explicitly accepted for a degraded target.",
    failingCommandOrTest: "pnpm test -- tests/settings-transport-diagnostics.test.ts tests/openclaw-gateway-config-errors.test.ts",
    regressionTestsToAddOrUpdate: [
      "tests/settings-transport-diagnostics.test.ts",
      "tests/openclaw-gateway-config-errors.test.ts"
    ]
  },
  "channels-accounts-scopes": {
    id: "channels-accounts-scopes",
    name: "Channels, accounts, and scopes",
    affectedAgentOsFiles: [
      "lib/openclaw/application/channel-service.ts",
      "lib/openclaw/application/runtime-issue-service.ts",
      "lib/openclaw/gateway-auth-actions.ts"
    ],
    suggestedFixScope: "Restore channel/account/scope handling through OpenClaw Gateway and visible Runtime Inbox recovery.",
    recommendedNextAction: "Resolve scope approval or channel/account capability gaps before certifying.",
    failingCommandOrTest: "pnpm test -- tests/openclaw-channel-service.test.ts tests/runtime-issues.test.ts",
    regressionTestsToAddOrUpdate: [
      "tests/openclaw-channel-service.test.ts",
      "tests/runtime-issues.test.ts"
    ]
  },
  "runtime-smoke": {
    id: "runtime-smoke",
    name: "Runtime smoke behavior",
    affectedAgentOsFiles: [
      "lib/openclaw/application/compatibility-smoke-service.ts",
      "lib/openclaw/application/runtime-service.ts",
      "scripts/openclaw-runtime-golden-smoke.mjs"
    ],
    suggestedFixScope: "Restore real runtime smoke behavior without masking model/auth/Gateway failures.",
    recommendedNextAction: "Run compatibility smoke and fix required failures before certifying.",
    failingCommandOrTest: "pnpm test -- tests/openclaw-compatibility-smoke.test.ts",
    regressionTestsToAddOrUpdate: ["tests/openclaw-compatibility-smoke.test.ts"]
  },
  "rollback-recovery": {
    id: "rollback-recovery",
    name: "Rollback and recovery evidence",
    affectedAgentOsFiles: [
      "lib/openclaw/update-safety.ts",
      "lib/openclaw/update-recovery.ts",
      "lib/openclaw/update-rollback.ts",
      "lib/openclaw/certification-scorecard.ts"
    ],
    suggestedFixScope: "Preserve rollback metadata and scorecard evidence before allowing any certification claim.",
    recommendedNextAction: "Run round-trip certification or keep the target uncertified.",
    failingCommandOrTest: "pnpm test -- tests/openclaw-certification-scorecard.test.ts tests/openclaw-update-compatibility.test.ts",
    regressionTestsToAddOrUpdate: [
      "tests/openclaw-certification-scorecard.test.ts",
      "tests/openclaw-update-compatibility.test.ts"
    ]
  }
};

export function getOpenClawCompatibilityLabAreaDefinition(areaId: OpenClawCompatibilityLabAreaId) {
  return OPENCLAW_COMPATIBILITY_LAB_AREAS[areaId];
}

import {
  OPENCLAW_NATIVE_CONTRACT_VERSION,
  OPENCLAW_SUPPORTED_BASELINE_VERSION
} from "@/lib/openclaw/versions";

export type OpenClawFallbackClassification =
  | "native-nonexistent"
  | "native-unintegrated"
  | "legacy-baseline"
  | "setup-recovery"
  | "technical-debt"
  | "unsafe"
  | "obsolete";

export type OpenClawFallbackRegistryEntry = {
  id: string;
  operation: string;
  sourcePath: string;
  sourceAnchors: readonly string[];
  nativeMethodCandidate: string | null;
  classification: OpenClawFallbackClassification;
  reason: string;
  minimumSupportedOpenClaw: string;
  fallbackAllowed: boolean;
  diagnostics: {
    channel: "gateway-fallback" | "cli-command" | "capability-matrix" | "compatibility-report";
    counterKey: string | null;
    observable: string;
  };
  owner: string;
  removalCondition: string;
  /** Exact contract version used when the native candidate was audited. */
  nativeContractVersion?: string;
};

const baseline = OPENCLAW_SUPPORTED_BASELINE_VERSION;
const cliJsonAnchor = (suffix: string) => `${["runOpenClaw", "Json"].join("")}${suffix}`;

/**
 * Static governance metadata only. This registry never selects or executes a
 * fallback; the existing Gateway client and command diagnostics remain the
 * runtime authority.
 */
const fallbackRegistryEntries = [
  {
    id: "cli-runner.command",
    operation: "cli.command",
    sourcePath: "lib/openclaw/cli.ts",
    sourceAnchors: ["export async function runOpenClaw(", cliJsonAnchor("<T>(")],
    nativeMethodCandidate: null,
    classification: "technical-debt",
    reason: "This is the bounded command and JSON diagnostic primitive used by explicit compatibility and recovery paths.",
    minimumSupportedOpenClaw: baseline,
    fallbackAllowed: true,
    diagnostics: {
      channel: "cli-command",
      counterKey: null,
      observable: "getRecentOpenClawCommandDiagnostics()"
    },
    owner: "AgentOS OpenClaw boundary",
    removalCondition: "Remove only after every caller is native Gateway-backed or an approved setup/recovery owner."
  },
  {
    id: "gateway-client.native-fallback",
    operation: "gateway.request",
    sourcePath: "lib/openclaw/client/native-ws-gateway-client.ts",
    sourceAnchors: ["this.fallback = options.fallback ?? new CliOpenClawGatewayClient();", "recordGatewayFallback(operation, error)"],
    nativeMethodCandidate: null,
    classification: "legacy-baseline",
    reason: "Native Gateway requests remain preferred; the existing client falls back only when its typed policy permits recovery.",
    minimumSupportedOpenClaw: baseline,
    fallbackAllowed: true,
    diagnostics: {
      channel: "gateway-fallback",
      counterKey: "native-operation",
      observable: "fallbackCounts, fallbackTotal, and recentFallbackDiagnostics"
    },
    owner: "AgentOS OpenClaw client boundary",
    removalCondition: "Remove when the supported baseline has stable native coverage for every governed request family."
  },
  {
    id: "gateway-factory.cli-mode",
    operation: "gateway.transport",
    sourcePath: "lib/openclaw/client/gateway-client-factory.ts",
    sourceAnchors: ["new CliOpenClawGatewayClient", "isCliGatewayClientForcedByEnv()"],
    nativeMethodCandidate: null,
    classification: "setup-recovery",
    reason: "Explicit CLI-forced mode is a recovery and diagnostics mode, not the normal native transport path.",
    minimumSupportedOpenClaw: baseline,
    fallbackAllowed: true,
    diagnostics: {
      channel: "capability-matrix",
      counterKey: "cli-forced",
      observable: "capabilityMatrix.operations[*].mode and cliFallback"
    },
    owner: "AgentOS OpenClaw client boundary",
    removalCondition: "Remove after local recovery no longer needs an explicit CLI-forced mode."
  },
  {
    id: "gateway-client.compatibility-export",
    operation: "gateway.client-compatibility",
    sourcePath: "lib/openclaw/client/gateway-client.ts",
    sourceAnchors: ["export { CliOpenClawGatewayClient }"],
    nativeMethodCandidate: null,
    classification: "legacy-baseline",
    reason: "The compatibility export preserves the existing typed client boundary for older integrations and tests.",
    minimumSupportedOpenClaw: baseline,
    fallbackAllowed: true,
    diagnostics: {
      channel: "capability-matrix",
      counterKey: "client-compatibility",
      observable: "transport diagnostics"
    },
    owner: "AgentOS OpenClaw client boundary",
    removalCondition: "Remove after downstream compatibility imports are migrated to the official-backed client."
  },
  {
    id: "cli-gateway.status",
    operation: "status",
    sourcePath: "lib/openclaw/client/cli-gateway-client.ts",
    sourceAnchors: [cliJsonAnchor("<StatusPayload>([\"status\", \"--json\"], options);")],
    nativeMethodCandidate: "status",
    classification: "legacy-baseline",
    reason: "Status is native-first in production, while CLI remains available for unavailable or explicitly forced Gateway recovery.",
    minimumSupportedOpenClaw: baseline,
    fallbackAllowed: true,
    diagnostics: { channel: "gateway-fallback", counterKey: "status", observable: "status fallback diagnostic" },
    owner: "OpenClaw Gateway client",
    removalCondition: "Remove after the supported baseline guarantees an authenticated native status path in all supported deployments."
  },
  {
    id: "cli-gateway.update-status",
    operation: "update.status",
    sourcePath: "lib/openclaw/client/cli-gateway-client.ts",
    sourceAnchors: [cliJsonAnchor("<OpenClawUpdateStatusPayload>([\"update\", \"status\", \"--json\"], options);")],
    nativeMethodCandidate: "update.status",
    classification: "legacy-baseline",
    reason: "Update status is read through the existing CLI fallback when native update status is unavailable.",
    minimumSupportedOpenClaw: baseline,
    fallbackAllowed: true,
    diagnostics: { channel: "gateway-fallback", counterKey: "update.status", observable: "update fallback diagnostic" },
    owner: "OpenClaw update boundary",
    removalCondition: "Remove after native update.status is verified across the supported baseline and recovery tests."
  },
  {
    id: "cli-gateway.models",
    operation: "models.list",
    sourcePath: "lib/openclaw/client/cli-gateway-client.ts",
    sourceAnchors: [cliJsonAnchor("<ModelsPayload>(args, options);")],
    nativeMethodCandidate: "models.list",
    classification: "native-unintegrated",
    reason: "Model discovery has a native Gateway candidate, but the CLI remains the existing compatibility discovery path.",
    minimumSupportedOpenClaw: baseline,
    fallbackAllowed: true,
    diagnostics: { channel: "gateway-fallback", counterKey: "models", observable: "model fallback diagnostic" },
    owner: "OpenClaw model boundary",
    removalCondition: "Remove after native models.list covers discovery and the CLI path is no longer needed for recovery."
  },
  {
    id: "cli-gateway.model-scan",
    operation: "models.scan",
    sourcePath: "lib/openclaw/client/cli-gateway-client.ts",
    sourceAnchors: [cliJsonAnchor("<OpenClawModelScanPayload>(args, options);")],
    nativeMethodCandidate: null,
    classification: "native-nonexistent",
    reason: "The exact OpenClaw 2026.9.4 Gateway contract does not expose models.scan; retain this bounded CLI compatibility operation until a native scan contract exists.",
    minimumSupportedOpenClaw: baseline,
    fallbackAllowed: true,
    diagnostics: { channel: "gateway-fallback", counterKey: "models.scan", observable: "model scan diagnostic" },
    owner: "OpenClaw model boundary",
    removalCondition: "Remove when models.scan has a stable typed Gateway contract and native integration."
  },
  {
    id: "cli-gateway.generic-rpc",
    operation: "gateway.call",
    sourcePath: "lib/openclaw/client/cli-gateway-client.ts",
    sourceAnchors: ["[\"gateway\", \"call\", method, \"--params\", JSON.stringify(params), \"--json\"]"],
    nativeMethodCandidate: null,
    classification: "legacy-baseline",
    reason: "Generic CLI Gateway calls preserve older method families while native typed methods are introduced incrementally.",
    minimumSupportedOpenClaw: baseline,
    fallbackAllowed: true,
    diagnostics: { channel: "gateway-fallback", counterKey: "gateway.call", observable: "per-operation fallback diagnostic" },
    owner: "OpenClaw Gateway client",
    removalCondition: "Remove each family after its typed native method and response contract are certified."
  },
  {
    id: "cli-gateway.config",
    operation: "config",
    sourcePath: "lib/openclaw/client/cli-gateway-client.ts",
    sourceAnchors: ["[\"config\", \"get\", path, \"--json\"]", "return runOpenClaw(args, options);"],
    nativeMethodCandidate: "config.get / config.patch / config.apply",
    classification: "technical-debt",
    reason: "Config reads and writes retain CLI compatibility for older Gateway versions and explicitly bounded recovery paths.",
    minimumSupportedOpenClaw: baseline,
    fallbackAllowed: true,
    diagnostics: { channel: "gateway-fallback", counterKey: "config", observable: "config fallback diagnostic" },
    owner: "OpenClaw config boundary",
    removalCondition: "Remove after native config snapshot, schema, and mutation support is certified for the baseline."
  },
  {
    id: "cli-gateway.sessions-tasks-artifacts",
    operation: "sessions.tasks.artifacts",
    sourcePath: "lib/openclaw/client/cli-gateway-client.ts",
    sourceAnchors: ["this.call<OpenClawSessionsPayload>(\"sessions.list\"", "this.call<OpenClawTaskListPayload>(\"tasks.list\"", "this.call<OpenClawArtifactListPayload>(\"artifacts.list\""],
    nativeMethodCandidate: "sessions.list / tasks.list / artifacts.list",
    classification: "legacy-baseline",
    reason: "Session, task, and artifact reads use the generic CLI Gateway compatibility path when native typed coverage is unavailable.",
    minimumSupportedOpenClaw: baseline,
    fallbackAllowed: true,
    diagnostics: { channel: "gateway-fallback", counterKey: "sessions.tasks.artifacts", observable: "per-operation fallback diagnostic" },
    owner: "OpenClaw runtime projections",
    removalCondition: "Remove after native session, task, and artifact response shapes are certified without compatibility calls."
  },
  {
    id: "cli-gateway.channel-logs",
    operation: "channels.logs",
    sourcePath: "lib/openclaw/client/cli-gateway-client.ts",
    sourceAnchors: [cliJsonAnchor("<OpenClawChannelLogsPayload>(args, options);")],
    nativeMethodCandidate: null,
    classification: "native-nonexistent",
    reason: "The exact OpenClaw 2026.9.4 Gateway contract does not expose channels.logs; CLI log retrieval remains the documented recovery path.",
    minimumSupportedOpenClaw: baseline,
    fallbackAllowed: true,
    diagnostics: { channel: "gateway-fallback", counterKey: "channels.logs", observable: "channel fallback diagnostic" },
    owner: "OpenClaw channel boundary",
    removalCondition: "Remove after channels.logs is a certified native typed method."
  },
  {
    id: "cli-gateway.channel-setup",
    operation: "channels.provision",
    sourcePath: "lib/openclaw/client/cli-gateway-client.ts",
    sourceAnchors: ["return runOpenClaw(args, options);", "return runOpenClaw(buildGmailSetupArgs(input), options);"],
    nativeMethodCandidate: null,
    classification: "setup-recovery",
    reason: "The exact OpenClaw 2026.9.4 Gateway contract does not expose channel or Gmail provisioning methods; retain OpenClaw-owned CLI setup.",
    minimumSupportedOpenClaw: baseline,
    fallbackAllowed: true,
    diagnostics: { channel: "cli-command", counterKey: "channels.provision", observable: "command diagnostics and setup result" },
    owner: "OpenClaw channel setup",
    removalCondition: "Remove after native channel and Gmail provisioning contracts are available and certified."
  },
  {
    id: "cli-gateway.channel-removal",
    operation: "channels.remove",
    sourcePath: "lib/openclaw/client/cli-gateway-client.ts",
    sourceAnchors: ["      \"channels\",\n      \"remove\","],
    nativeMethodCandidate: null,
    classification: "setup-recovery",
    reason: "The exact OpenClaw 2026.9.4 Gateway contract does not expose channel removal; retain the explicit CLI recovery path subject to the caller's authorization boundary.",
    minimumSupportedOpenClaw: baseline,
    fallbackAllowed: true,
    diagnostics: { channel: "cli-command", counterKey: "channels.remove", observable: "command diagnostics" },
    owner: "OpenClaw channel setup",
    removalCondition: "Remove after native channel removal is certified and all callers use it."
  },
  {
    id: "cli-gateway.agent-lifecycle",
    operation: "agents.lifecycle",
    sourcePath: "lib/openclaw/client/cli-gateway-client.ts",
    sourceAnchors: ["return runOpenClaw(args, options);", "return runOpenClaw(buildAgentIdentityArgs(input), options);", "return runOpenClaw([\"agents\", \"delete\""],
    nativeMethodCandidate: "agents.create / agents.update / agents.delete",
    classification: "native-unintegrated",
    reason: "Agent lifecycle and identity commands preserve compatibility around native calls and AgentOS-owned metadata side effects.",
    minimumSupportedOpenClaw: baseline,
    fallbackAllowed: true,
    diagnostics: { channel: "gateway-fallback", counterKey: "agents.lifecycle", observable: "per-operation fallback diagnostic" },
    owner: "OpenClaw agent boundary",
    removalCondition: "Remove after native lifecycle and identity operations cover all required metadata side effects."
  },
  {
    id: "cli-gateway.mission-turn",
    operation: "chat.send",
    sourcePath: "lib/openclaw/client/cli-gateway-client.ts",
    sourceAnchors: [cliJsonAnchor("<MissionCommandPayload>(buildAgentTurnArgs(input), options);"), cliJsonAnchor("Stream<MissionCommandPayload>(buildAgentTurnArgs(input),")],
    nativeMethodCandidate: "chat.send / sessions.send",
    classification: "legacy-baseline",
    reason: "Mission dispatch keeps CLI runner and transcript-compatible recovery for older or status-only Gateway behavior.",
    minimumSupportedOpenClaw: baseline,
    fallbackAllowed: true,
    diagnostics: { channel: "gateway-fallback", counterKey: "chat.send", observable: "mission fallback diagnostic" },
    owner: "OpenClaw mission boundary",
    removalCondition: "Remove after native dispatch, streaming, and transcript recovery are certified across the baseline."
  },
  {
    id: "cli-gateway.skills-and-plugins",
    operation: "skills.plugins",
    sourcePath: "lib/openclaw/client/cli-gateway-client.ts",
    sourceAnchors: [cliJsonAnchor("<OpenClawSkillListPayload>(args, options);"), cliJsonAnchor("<OpenClawPluginListPayload>([\"plugins\", \"list\", \"--json\"], options);")],
    nativeMethodCandidate: "skills.status / plugins.list",
    classification: "native-unintegrated",
    reason: "Runtime skill and plugin inventory retains compatibility CLI reads; this does not authorize a CLI fallback for plugins.catalog.*.",
    minimumSupportedOpenClaw: baseline,
    fallbackAllowed: true,
    diagnostics: { channel: "gateway-fallback", counterKey: "skills.plugins", observable: "inventory fallback diagnostic" },
    owner: "OpenClaw capability boundary",
    removalCondition: "Remove after native inventory methods are certified; keep plugin catalog entries native-only."
  },
  {
    id: "plugin-catalog.native-only",
    operation: "plugins.catalog",
    sourcePath: "lib/openclaw/client/gateway-compatibility.ts",
    sourceAnchors: ["plugins.catalog.browse", "plugins.catalog.categories", "plugins.catalog.get"],
    nativeMethodCandidate: "plugins.catalog.browse",
    classification: "native-unintegrated",
    reason: "Phase 6 plugin catalog operations are OpenClaw-native only; no CLI command is an equivalent catalog contract.",
    minimumSupportedOpenClaw: baseline,
    fallbackAllowed: false,
    diagnostics: { channel: "capability-matrix", counterKey: null, observable: "pluginCatalog operation mode=disabled when unavailable" },
    owner: "OpenClaw native plugin catalog",
    removalCondition: "Remove only when the native catalog contract is retired or fully replaced by an authoritative OpenClaw method."
  },
  {
    id: "adapter.memory-cli",
    operation: "memory.index",
    sourcePath: "lib/openclaw/adapter/openclaw-adapter.ts",
    sourceAnchors: ["this.cliMemoryFallback = cliMemoryFallback ?? new CliOpenClawGatewayClient({"],
    nativeMethodCandidate: "memory.search / doctor.memory.status",
    classification: "setup-recovery",
    reason: "Memory maintenance uses the existing same-runtime locality proof before allowing CLI status or index recovery.",
    minimumSupportedOpenClaw: baseline,
    fallbackAllowed: true,
    diagnostics: { channel: "gateway-fallback", counterKey: "memory.index", observable: "memory fallback availability and diagnostics" },
    owner: "OpenClaw memory boundary",
    removalCondition: "Remove after native memory index status and rebuild operations are stable in the supported baseline."
  },
  {
    id: "application.channel-connect",
    operation: "channels.setup",
    sourcePath: "lib/openclaw/application/channel-connect-service.ts",
    sourceAnchors: ["await runOpenClaw(commandArgs", "await runOpenClaw(args", cliJsonAnchor("<{")],
    nativeMethodCandidate: "channels.status / channels.start",
    classification: "setup-recovery",
    reason: "Provider plugin installation and pairing approval remain explicit OpenClaw-owned setup/recovery commands with authorization proof.",
    minimumSupportedOpenClaw: baseline,
    fallbackAllowed: true,
    diagnostics: { channel: "cli-command", counterKey: "channels.setup", observable: "setup command diagnostics" },
    owner: "OpenClaw channel setup",
    removalCondition: "Remove after every supported provider setup action has a certified native Gateway equivalent."
  },
  {
    id: "application.chatgpt-auth",
    operation: "models.auth.login",
    sourcePath: "lib/openclaw/application/chatgpt-provider-auth-service.ts",
    sourceAnchors: ["await runOpenClaw(args, { timeoutMs });", "runOpenClawChatGptInteractiveLogin"],
    nativeMethodCandidate: null,
    classification: "setup-recovery",
    reason: "Interactive ChatGPT OAuth is intentionally delegated to OpenClaw's CLI flow; no stable native equivalent is assumed.",
    minimumSupportedOpenClaw: baseline,
    fallbackAllowed: true,
    diagnostics: { channel: "cli-command", counterKey: "models.auth.login", observable: "auth session state and redacted command diagnostics" },
    owner: "OpenClaw model authentication",
    removalCondition: "Remove after OpenClaw exposes a stable authenticated OAuth/device flow usable by AgentOS."
  },
  {
    id: "application.gateway-doctor",
    operation: "gateway.doctor",
    sourcePath: "lib/openclaw/application/gateway-service.ts",
    sourceAnchors: ["runOpenClaw([\"doctor\", \"--fix\"]"],
    nativeMethodCandidate: null,
    classification: "setup-recovery",
    reason: "Doctor repair remains OpenClaw-owned process recovery and must not be replaced by an AgentOS runtime.",
    minimumSupportedOpenClaw: baseline,
    fallbackAllowed: true,
    diagnostics: { channel: "cli-command", counterKey: "gateway.doctor", observable: "command output and recovery result" },
    owner: "OpenClaw lifecycle",
    removalCondition: "Remove only if OpenClaw provides an equivalent authenticated native Doctor repair surface."
  },
  {
    id: "application.gateway-dashboard",
    operation: "gateway.dashboard",
    sourcePath: "lib/openclaw/application/gateway-service.ts",
    sourceAnchors: ["runOpenClaw([\"dashboard\"]"],
    nativeMethodCandidate: null,
    classification: "native-nonexistent",
    reason: "Opening the OpenClaw dashboard is a CLI-owned local operator action with no Gateway RPC equivalent.",
    minimumSupportedOpenClaw: baseline,
    fallbackAllowed: true,
    diagnostics: { channel: "cli-command", counterKey: "gateway.dashboard", observable: "command diagnostics" },
    owner: "OpenClaw local operator workflow",
    removalCondition: "Remove when OpenClaw exposes an authoritative dashboard-open API or the action is retired."
  },
  {
    id: "application.mobile-pairing",
    operation: "device.pair.setupCode",
    sourcePath: "lib/openclaw/application/mobile-pairing-service.ts",
    sourceAnchors: [cliJsonAnchor("<OpenClawSetupCodePayload>([\"qr\", \"--json\"]")],
    nativeMethodCandidate: "device.pair.setupCode",
    classification: "setup-recovery",
    reason: "QR pairing falls back to the CLI only after native setup-code access fails and verified authorization is present.",
    minimumSupportedOpenClaw: baseline,
    fallbackAllowed: true,
    diagnostics: { channel: "gateway-fallback", counterKey: "device.pair.setupCode", observable: "pairing fallback diagnostic" },
    owner: "OpenClaw device pairing",
    removalCondition: "Remove after native setup-code support is stable across supported pairing environments."
  },
  {
    id: "application.task-health",
    operation: "tasks.health",
    sourcePath: "lib/openclaw/application/task-health-service.ts",
    sourceAnchors: [cliJsonAnchor("?: typeof ") + cliJsonAnchor("")],
    nativeMethodCandidate: "tasks.list / tasks.history",
    classification: "legacy-baseline",
    reason: "Task health keeps an injectable CLI JSON boundary for legacy task/session compatibility and deterministic tests.",
    minimumSupportedOpenClaw: baseline,
    fallbackAllowed: true,
    diagnostics: { channel: "cli-command", counterKey: "tasks.health", observable: "task health diagnostics" },
    owner: "OpenClaw task projection",
    removalCondition: "Remove after task health consumes only certified native task history and event evidence."
  },
  {
    id: "application.compatibility-smoke",
    operation: "compatibility.fallback-behavior",
    sourcePath: "lib/openclaw/application/compatibility-smoke-service.ts",
    sourceAnchors: ["fallback: new CliOpenClawGatewayClient()"],
    nativeMethodCandidate: "status",
    classification: "setup-recovery",
    reason: "The compatibility smoke test deliberately exercises the existing fallback path without changing runtime ownership.",
    minimumSupportedOpenClaw: baseline,
    fallbackAllowed: true,
    diagnostics: { channel: "compatibility-report", counterKey: "fallback-behavior", observable: "compatibility smoke report" },
    owner: "OpenClaw compatibility lab",
    removalCondition: "Remove after certification no longer needs an explicit native-failure fallback probe."
  },
  {
    id: "application.status-probe",
    operation: "status.diagnostic-probe",
    sourcePath: "lib/openclaw/application/mission-control/diagnostics.ts",
    sourceAnchors: ["runOpenClaw([\"status\", \"--json\"]"],
    nativeMethodCandidate: "status",
    classification: "technical-debt",
    reason: "The diagnostic warning probe supplements native status with existing command history when the Gateway is unavailable.",
    minimumSupportedOpenClaw: baseline,
    fallbackAllowed: true,
    diagnostics: { channel: "cli-command", counterKey: "status.diagnostic-probe", observable: "command history in diagnostics" },
    owner: "AgentOS diagnostics",
    removalCondition: "Remove after native status diagnostics expose equivalent command failure evidence."
  },
  {
    id: "migration.command",
    operation: "migration.command",
    sourcePath: "lib/openclaw/migration-engine/runtime.ts",
    sourceAnchors: ["runOpenClawMigrationCommand"],
    nativeMethodCandidate: null,
    classification: "setup-recovery",
    reason: "Migration commands are bounded OpenClaw-owned lifecycle work and retain redacted output and mutation allowlist checks.",
    minimumSupportedOpenClaw: baseline,
    fallbackAllowed: true,
    diagnostics: { channel: "cli-command", counterKey: "migration.command", observable: "migration evidence artifact" },
    owner: "OpenClaw migration engine",
    removalCondition: "Remove after OpenClaw exposes an equivalent native migration lifecycle API."
  },
  {
    id: "reset.uninstall",
    operation: "reset.uninstall",
    sourcePath: "lib/openclaw/reset.ts",
    sourceAnchors: ["runOpenClaw([\n      \"uninstall\",", "runOpenClawFullUninstall"],
    nativeMethodCandidate: null,
    classification: "setup-recovery",
    reason: "Explicit reset/uninstall delegates destructive runtime ownership to OpenClaw and reports failure before local cleanup.",
    minimumSupportedOpenClaw: baseline,
    fallbackAllowed: true,
    diagnostics: { channel: "cli-command", counterKey: "reset.uninstall", observable: "reset stream events" },
    owner: "OpenClaw lifecycle",
    removalCondition: "Remove only when OpenClaw offers an equivalent supported reset/uninstall API."
  },
  {
    id: "certification.runtime",
    operation: "certification.runtime",
    sourcePath: "lib/openclaw/runtime-certification/harness.ts",
    sourceAnchors: ["runOpenClawRuntimeCertification"],
    nativeMethodCandidate: null,
    classification: "setup-recovery",
    reason: "Certification harnesses are explicit evidence-producing compatibility paths and do not represent product runtime fallback selection.",
    minimumSupportedOpenClaw: baseline,
    fallbackAllowed: true,
    diagnostics: { channel: "compatibility-report", counterKey: "certification.runtime", observable: "certification evidence artifact" },
    owner: "OpenClaw compatibility lab",
    removalCondition: "Remove after the certification harness no longer exercises CLI-backed recovery evidence."
  },
  {
    id: "certification.runtime-script",
    operation: "certification.runtime-script",
    sourcePath: "scripts/openclaw-runtime-certification.ts",
    sourceAnchors: ["runOpenClawRuntimeCertification({"],
    nativeMethodCandidate: null,
    classification: "setup-recovery",
    reason: "The release certification script invokes the bounded runtime harness and records evidence without mutating external release state.",
    minimumSupportedOpenClaw: baseline,
    fallbackAllowed: true,
    diagnostics: { channel: "compatibility-report", counterKey: "certification.runtime-script", observable: "certification report" },
    owner: "OpenClaw compatibility lab",
    removalCondition: "Remove after certification is fully native and the script is retired."
  },
  {
    id: "certification.compatibility-route",
    operation: "compatibility.smoke-route",
    sourcePath: "app/api/openclaw/compatibility-smoke/route.ts",
    sourceAnchors: ["runOpenClawCompatibilitySmokeTest"],
    nativeMethodCandidate: null,
    classification: "setup-recovery",
    reason: "The compatibility route projects bounded smoke evidence; it does not create a second fallback engine.",
    minimumSupportedOpenClaw: baseline,
    fallbackAllowed: true,
    diagnostics: { channel: "compatibility-report", counterKey: "compatibility.smoke-route", observable: "compatibility smoke response" },
    owner: "OpenClaw compatibility lab",
    removalCondition: "Remove when the compatibility route is retired in favor of the certified diagnostics surface."
  },
  {
    id: "update.route-cli-probes",
    operation: "update.preflight",
    sourcePath: "app/api/update/route.ts",
    sourceAnchors: ["runOpenClawPreUpdateStatusCheck", "runOpenClawUpdateDryRun", "runOpenClawShadowProbe"],
    nativeMethodCandidate: "update.status / update.run",
    classification: "setup-recovery",
    reason: "Update preflight and dry-run probes preserve OpenClaw updater ownership and remain non-mutating compatibility checks.",
    minimumSupportedOpenClaw: baseline,
    fallbackAllowed: true,
    diagnostics: { channel: "compatibility-report", counterKey: "update.preflight", observable: "update preflight report" },
    owner: "OpenClaw update boundary",
    removalCondition: "Remove after native updater preflight and dry-run evidence is certified for every supported runtime."
  }
] as const satisfies readonly OpenClawFallbackRegistryEntry[];

/**
 * The registry is governance metadata, not a runtime selector. Attach the
 * exact contract identity and the current source site to every entry so
 * diagnostics cannot accidentally present a stale candidate as 9.4 native
 * coverage.
 */
export const OPENCLAW_FALLBACK_REGISTRY = fallbackRegistryEntries.map((entry) => ({
  ...entry,
  nativeContractVersion: OPENCLAW_NATIVE_CONTRACT_VERSION
})) satisfies readonly OpenClawFallbackRegistryEntry[];

export type OpenClawFallbackRegistrySummary = {
  registryVersion: 1;
  fallbackMode: "native-first-governed-cli-recovery";
  nativeContractVersion: string;
  fallbackAllowed: boolean;
  totalEntries: number;
  allowedEntryCount: number;
  disallowedEntryCount: number;
  sourcePathCount: number;
  classifications: Record<OpenClawFallbackClassification, number>;
  allowedOperationIds: string[];
  disallowedOperationIds: string[];
  sourcePaths: string[];
};

export function getOpenClawFallbackRegistrySummary(): OpenClawFallbackRegistrySummary {
  const classifications = Object.fromEntries(
    (["native-nonexistent", "native-unintegrated", "legacy-baseline", "setup-recovery", "technical-debt", "unsafe", "obsolete"] as const)
      .map((classification) => [classification, OPENCLAW_FALLBACK_REGISTRY.filter((entry) => entry.classification === classification).length])
  ) as Record<OpenClawFallbackClassification, number>;
  const allowedEntries = OPENCLAW_FALLBACK_REGISTRY.filter((entry) => entry.fallbackAllowed);
  const disallowedEntries = OPENCLAW_FALLBACK_REGISTRY.filter((entry) => !entry.fallbackAllowed);

  return {
    registryVersion: 1,
    fallbackMode: "native-first-governed-cli-recovery",
    nativeContractVersion: OPENCLAW_NATIVE_CONTRACT_VERSION,
    fallbackAllowed: allowedEntries.length > 0,
    totalEntries: OPENCLAW_FALLBACK_REGISTRY.length,
    allowedEntryCount: allowedEntries.length,
    disallowedEntryCount: disallowedEntries.length,
    sourcePathCount: new Set(OPENCLAW_FALLBACK_REGISTRY.map((entry) => entry.sourcePath)).size,
    classifications,
    allowedOperationIds: allowedEntries.map((entry) => entry.id),
    disallowedOperationIds: disallowedEntries.map((entry) => entry.id),
    sourcePaths: [...new Set(OPENCLAW_FALLBACK_REGISTRY.map((entry) => entry.sourcePath))]
  };
}

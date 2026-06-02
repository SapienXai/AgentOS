import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const rootDir = process.cwd();

function toProjectPath(filePath: string) {
  return path.relative(rootDir, filePath).split(path.sep).join("/");
}

function walkFiles(dir: string, predicate: (filePath: string) => boolean) {
  const files: string[] = [];

  for (const entry of readdirSync(dir)) {
    const filePath = path.join(dir, entry);
    const stat = statSync(filePath);

    if (stat.isDirectory()) {
      files.push(...walkFiles(filePath, predicate));
      continue;
    }

    if (stat.isFile() && predicate(filePath)) {
      files.push(filePath);
    }
  }

  return files;
}

function readProjectSourceFiles(dirs: string[]) {
  return dirs.flatMap((dir) =>
    walkFiles(path.join(rootDir, dir), (filePath) => /\.(ts|tsx)$/.test(filePath))
  );
}

test("OpenClaw production code does not import the legacy service entrypoint", () => {
  const productionFiles = readProjectSourceFiles(["app", "components", "hooks", "lib"]).filter(
    (filePath) => toProjectPath(filePath) !== "lib/openclaw/service.ts"
  );
  const offenders = productionFiles
    .filter((filePath) => {
      const source = readFileSync(filePath, "utf8");
      return /from\s+["'][^"']*openclaw\/service["']/.test(source);
    })
    .map(toProjectPath);

  assert.deepEqual(offenders, []);
});

test("app, components, and hooks do not import low-level OpenClaw clients directly", () => {
  const allowedTransitionalApiRoutes = new Set([
    "app/api/models/providers/route.ts",
    "app/api/onboarding/models/route.ts",
    "app/api/onboarding/route.ts",
    "app/api/settings/openclaw-binary/route.ts",
    "app/api/update/route.ts"
  ]);
  const forbidden = [
    "@/lib/openclaw/cli",
    "@/lib/openclaw/client/cli-gateway-client",
    "@/lib/openclaw/client/native-ws-gateway-client",
    "@/lib/openclaw/client/gateway-client-factory"
  ];
  const offenders = readProjectSourceFiles(["app", "components", "hooks"])
    .filter((filePath) => !allowedTransitionalApiRoutes.has(toProjectPath(filePath)))
    .flatMap((filePath) => {
      const source = readFileSync(filePath, "utf8");
      return forbidden
        .filter((specifier) => source.includes(`from "${specifier}"`) || source.includes(`from '${specifier}'`))
        .map((specifier) => `${toProjectPath(filePath)} -> ${specifier}`);
    })
    .sort();

  assert.deepEqual(offenders, []);
});

test("OpenClaw direct CLI JSON usage remains in documented fallback/discovery files", () => {
  const allowed = new Set([
    "lib/openclaw/cli.ts",
    "lib/openclaw/client/cli-gateway-client.ts"
  ]);
  const offenders = readProjectSourceFiles(["lib/openclaw"])
    .filter((filePath) => readFileSync(filePath, "utf8").includes("runOpenClawJson"))
    .map(toProjectPath)
    .filter((filePath) => !allowed.has(filePath));

  assert.deepEqual(offenders, []);
});

test("OpenClaw direct CLI command usage remains in documented fallback/provisioning files", () => {
  const allowed = new Set([
    "lib/openclaw/client/cli-gateway-client.ts",
    "lib/openclaw/reset.ts"
  ]);
  const offenders = readProjectSourceFiles(["lib/openclaw"])
    .filter((filePath) => toProjectPath(filePath) !== "lib/openclaw/cli.ts")
    .filter((filePath) => {
      const source = readFileSync(filePath, "utf8");
      return /import\s+\{[^}]*\brunOpenClaw\b[^}]*\}\s+from\s+["']@\/lib\/openclaw\/cli["']/.test(source);
    })
    .map(toProjectPath)
    .filter((filePath) => !allowed.has(filePath));

  assert.deepEqual(offenders, []);
});

test("AgentOS contracts expose explicit runtime aliases instead of wildcard OpenClaw exports", () => {
  const source = readFileSync(path.join(rootDir, "lib/agentos/contracts.ts"), "utf8");

  assert.doesNotMatch(source, /export\s+type\s+\*\s+from\s+["']@\/lib\/openclaw\/types["']/);
  assert.match(source, /export type ControlPlaneSnapshot = MissionControlSnapshot;/);
  assert.match(source, /export type ControlPlaneDiagnostics = GatewayDiagnostics;/);
  assert.match(source, /export type AgentRecord = OpenClawAgent;/);
  assert.match(source, /export type RuntimeActivityRecord = RuntimeRecord;/);
  assert.match(source, /export type WorkItemRecord = TaskRecord;/);
  assert.match(source, /export type RuntimeEventFrame = \{/);
  assert.match(source, /export type RuntimeEventSubscriptionRequest = \{/);
  assert.match(source, /export type RuntimeSnapshotRecord = \{/);
});

test("app, components, and hooks use AgentOS aliases for core runtime records", () => {
  const forbiddenCoreContractTypes = [
    "GatewayDiagnostics",
    "OpenClawAgent",
    "RuntimeRecord",
    "TaskRecord",
    "WorkspaceProject"
  ];
  const offenders = readProjectSourceFiles(["app", "components", "hooks"])
    .flatMap((filePath) => {
      const source = readFileSync(filePath, "utf8");
      const matches = source.matchAll(
        /import\s+type\s+\{([\s\S]*?)\}\s+from\s+["']@\/lib\/agentos\/contracts["']/g
      );

      return Array.from(matches).flatMap((match) =>
        forbiddenCoreContractTypes
          .filter((typeName) => new RegExp(`\\b${typeName}\\b`).test(match[1]))
          .map((typeName) => `${toProjectPath(filePath)} -> ${typeName}`)
      );
    })
    .sort();

  assert.deepEqual(offenders, []);
});

test("model provider API route keeps local OpenClaw config state behind the application service", () => {
  const routeSource = readFileSync(path.join(rootDir, "app/api/models/providers/route.ts"), "utf8");
  const serviceSource = readFileSync(
    path.join(rootDir, "lib/openclaw/application/model-provider-state-service.ts"),
    "utf8"
  );

  assert.match(routeSource, /model-provider-state-service/);
  assert.doesNotMatch(routeSource, /node:fs\/promises|node:os|auth-profiles\.json|openclaw\.json|getOpenClawAdapter/);
  assert.match(serviceSource, /openclaw\.json/);
  assert.match(serviceSource, /auth-profiles\.json/);
});

test("local Gateway port probes do not claim authenticated RPC readiness", () => {
  const probeSource = readFileSync(path.join(rootDir, "lib/openclaw/client/local-gateway-probe.ts"), "utf8");
  const snapshotLoaderSource = readFileSync(
    path.join(rootDir, "lib/openclaw/application/mission-control/snapshot-loader.ts"),
    "utf8"
  );
  const systemReadinessSource = readFileSync(
    path.join(rootDir, "lib/openclaw/application/mission-control/system-readiness-snapshot.ts"),
    "utf8"
  );

  assert.doesNotMatch(probeSource, /rpc:\s*\{\s*ok:\s*true\s*\}/);
  assert.match(snapshotLoaderSource, /const openclawCliInstalled = await detectOpenClaw\(\);/);
  assert.match(snapshotLoaderSource, /const openclawInstalled = openclawCliInstalled \|\| Boolean\(localGatewayStatus\?\.rpc\?\.ok\);/);
  assert.match(snapshotLoaderSource, /const shouldHydrateGatewayStatus = gatewayStatusCacheNeedsRefresh;/);
  assert.doesNotMatch(snapshotLoaderSource, /const shouldHydrateGatewayStatus = !localGatewayStatus/);
  assert.match(snapshotLoaderSource, /let resolvedGatewayStatus = gatewayStatusCache\.resolve\(gatewayStatusResult\);/);
  assert.match(systemReadinessSource, /const gatewayStatusResult = await settleGatewayStatusPayloadFromOpenClaw\(3_000\);/);
});

test("runtime state uses Gateway snapshot and adapter event subscriptions", () => {
  const snapshotLoaderSource = readFileSync(
    path.join(rootDir, "lib/openclaw/application/mission-control/snapshot-loader.ts"),
    "utf8"
  );
  const runtimeReconciliationSource = readFileSync(
    path.join(rootDir, "lib/openclaw/application/mission-control/runtime-reconciliation.ts"),
    "utf8"
  );
  const eventBridgeSource = readFileSync(
    path.join(rootDir, "lib/openclaw/application/event-bridge-service.ts"),
    "utf8"
  );
  const runtimeStateSource = readFileSync(
    path.join(rootDir, "lib/openclaw/application/runtime-state-service.ts"),
    "utf8"
  );

  assert.match(snapshotLoaderSource, /settleRuntimeSnapshotPayloadFromOpenClaw/);
  assert.match(runtimeReconciliationSource, /mapOpenClawRuntimeSnapshotToRuntimes/);
  assert.match(eventBridgeSource, /getOpenClawAdapter\(\)\.subscribeRuntimeEvents/);
  assert.doesNotMatch(eventBridgeSource, /new NativeWsOpenClawGatewayClient/);
  assert.match(runtimeStateSource, /getOpenClawAdapter\(\)\.getRuntimeSnapshot/);
});

test("model auth repair and planner runtime turns stay behind the OpenClaw adapter", () => {
  const modelAuthSource = readFileSync(
    path.join(rootDir, "lib/openclaw/application/model-auth-service.ts"),
    "utf8"
  );
  const plannerSource = readFileSync(path.join(rootDir, "lib/openclaw/planner.ts"), "utf8");

  assert.match(modelAuthSource, /getOpenClawAdapter\(\)\.getAgentModelStatus/);
  assert.match(modelAuthSource, /getOpenClawAdapter\(\)\.setModelAuthOrder/);
  assert.doesNotMatch(modelAuthSource, /runOpenClaw(Json)?/);
  assert.match(plannerSource, /getOpenClawAdapter\(\)\.runAgentTurn/);
  assert.doesNotMatch(plannerSource, /runOpenClaw(Json)?/);
});

test("read-only agent config and channel discovery use the OpenClaw adapter", () => {
  const agentConfigSource = readFileSync(
    path.join(rootDir, "lib/openclaw/domains/agent-config.ts"),
    "utf8"
  );
  const channelsSource = readFileSync(path.join(rootDir, "lib/openclaw/domains/channels.ts"), "utf8");

  assert.match(agentConfigSource, /getOpenClawAdapter\(\)\.getConfig<MutableAgentConfigEntry\[\]>\("agents\.list"\)/);
  assert.match(channelsSource, /getOpenClawAdapter\(\)\.getConfig<TelegramAllowlistConfig>\("channels\.telegram\.groups"\)/);
  assert.match(channelsSource, /getOpenClawAdapter\(\)\.getConfig<DiscordGuildConfig>\("channels\.discord\.guilds"\)/);
  assert.match(channelsSource, /getOpenClawAdapter\(\)\.getChannelLogs/);
  assert.doesNotMatch(agentConfigSource, /runOpenClawJson/);
  assert.doesNotMatch(channelsSource, /runOpenClawJson/);
});

test("agent config writes stay behind the OpenClaw adapter without workspace identity sync", () => {
  const source = readFileSync(path.join(rootDir, "lib/openclaw/domains/agent-config.ts"), "utf8");

  assert.doesNotMatch(source, /from\s+["']@\/lib\/openclaw\/cli["']/);
  assert.doesNotMatch(source, /runOpenClaw/);
  assert.match(source, /getOpenClawAdapter\(\)\.setConfig\("agents\.list", configList, \{ strictJson: true \}\)/);
  assert.doesNotMatch(source, /getOpenClawAdapter\(\)\.setAgentIdentity/);
  assert.match(source, /writeFile\(identityFilePath, identityMarkdown, "utf8"\)/);
});

test("channel provisioning writes stay behind the OpenClaw adapter", () => {
  const source = readFileSync(path.join(rootDir, "lib/openclaw/application/channel-service.ts"), "utf8");

  assert.doesNotMatch(source, /from\s+["']@\/lib\/openclaw\/cli["']/);
  assert.doesNotMatch(source, /runOpenClaw/);
  assert.match(source, /getOpenClawAdapter\(\)\.provisionChannelAccount/);
  assert.match(source, /getOpenClawAdapter\(\)\.removeChannelAccount/);
  assert.match(source, /getOpenClawAdapter\(\)\.setupGmailWebhook/);
});

test("surface reconcile dry-run skips OpenClaw config writes and provider side effects", () => {
  const source = readFileSync(path.join(rootDir, "lib/openclaw/application/channel-service.ts"), "utf8");
  const surfaceRuntime = readFileSync(path.join(rootDir, "lib/openclaw/surface-runtime.ts"), "utf8");
  const route = readFileSync(path.join(rootDir, "app/api/workspaces/[workspaceId]/surfaces/reconcile/route.ts"), "utf8");
  const dialog = readFileSync(path.join(rootDir, "components/mission-control/workspace-channels-dialog.tsx"), "utf8");

  assert.match(source, /const dryRun = input\.dryRun === true/);
  assert.match(source, /readSurfaceReconcilePreviewAudit\(confirmedPreviewAuditId\)/);
  assert.match(source, /validateSurfaceReconcilePreviewForApply/);
  assert.match(source, /surfaceReconcilePreviewMaxAgeMs = 15 \* 60 \* 1000/);
  assert.match(source, /approvedSurfaceRepairConfigPaths = new Set/);
  assert.match(source, /assertApprovedSurfaceRepairConfigPaths\(plannedConfigPaths\)/);
  assert.match(surfaceRuntime, /Current OpenClaw bindings changed since preview/);
  assert.match(source, /writeSurfaceReconcileBackup/);
  assert.match(source, /surface-reconcile\.backup-read/);
  assert.match(source, /surface-reconcile\.backup-write/);
  assert.match(source, /previousConfigValues/);
  assert.match(source, /const backup = redactSecrets/);
  assert.match(source, /const audit = redactSecrets/);
  assert.match(source, /const configMutations = dryRun\s+\?\s+undefined\s+:\s+await measureTiming\([\s\S]*?applySurfaceConfigRepairPatch/);
  assert.match(source, /if \(scope === "all" && !dryRun\)/);
  assert.match(source, /if \(!dryRun\) \{\s+invalidateSnapshotCache\(\);/);
  assert.match(source, /writeSurfaceReconcileAudit/);
  assert.match(route, /surfaceReconcileApplyConfirmation = "apply-surface-reconcile"/);
  assert.match(route, /Surface repair apply requires explicit confirmation/);
  assert.match(route, /Surface repair apply requires a dry-run preview audit id/);
  assert.doesNotMatch(dialog, /window\.confirm/);
  assert.match(dialog, /Apply OpenClaw binding repair/);
  assert.match(dialog, /handleApplySurfaceRepairPreview/);
});

test("settings device access repair stays behind the OpenClaw adapter", () => {
  const source = readFileSync(path.join(rootDir, "lib/openclaw/application/settings-service.ts"), "utf8");

  assert.doesNotMatch(source, /from\s+["']@\/lib\/openclaw\/cli["']/);
  assert.doesNotMatch(source, /runOpenClawJson/);
  assert.match(source, /getOpenClawAdapter\(\)\.approveDeviceAccess/);
});

test("system onboarding repairs Gateway auth before runtime state verification", () => {
  const source = readFileSync(path.join(rootDir, "app/api/onboarding/route.ts"), "utf8");
  const repairIndex = source.indexOf("const repairedGatewayAuth = await repairGatewayAuthForSystemSetup");
  const runtimeStateIndex = source.indexOf("await touchOpenClawRuntimeStateAccess");

  assert.notEqual(repairIndex, -1);
  assert.notEqual(runtimeStateIndex, -1);
  assert.equal(repairIndex < runtimeStateIndex, true);
  assert.match(source, /const readyTimeoutMs = 60_000/);
  assert.match(source, /const postAuthRepairReadyTimeoutMs = 90_000/);
  assert.match(source, /const readyStatusIntervalMs = 5_000/);
  assert.match(source, /waitForReadySnapshotAfterGatewayAuthRepair/);
  assert.match(source, /clearMissionControlCaches\(\);/);
  assert.match(source, /\["gateway", "restart", "--force", "--json"\]/);
  assert.match(source, /repairGatewayAuthForSystemSetup\(\s*latestSnapshot,\s*send,\s*gatewayStatusRetry,\s*openClawBin\s*\)/);
  assert.match(source, /resolveGatewayAuthSetupIssueFromGatewayStatus/);
  assert.match(source, /syncGatewayAuthTokenBeforeFirstStart/);
  assert.match(source, /gatewayInstallNeedsAgentOsTokenSync/);
  assert.match(source, /saveGatewayNativeAuthCredential/);
  assert.match(source, /Preparing Gateway auth for AgentOS before first start/);
  assert.match(source, /needsGatewayBootstrapConfigRepair/);
  assert.match(source, /\["config", "set", "gateway\.mode", "local"\]/);
  assert.match(source, /generateGatewayNativeAuthToken\(\{\s*verifyDelaysMs/);
  assert.match(source, /AgentOS repaired local Gateway token auth during system setup verification/);
});

test("system onboarding prepares local Gateway config before waiting on native readiness", () => {
  const source = readFileSync(path.join(rootDir, "app/api/onboarding/route.ts"), "utf8");
  const preStartRepairIndex = source.indexOf("if (needsGatewayBootstrapConfigRepair(gatewayStatus))");
  const startIndex = source.indexOf('message: "Starting the local gateway service..."');
  const postStartRepairIndex = source.indexOf("Gateway service started without usable local config");
  const waitIndex = source.indexOf('message: "Waiting for AgentOS to detect a live OpenClaw gateway..."');

  assert.notEqual(preStartRepairIndex, -1);
  assert.notEqual(startIndex, -1);
  assert.notEqual(postStartRepairIndex, -1);
  assert.notEqual(waitIndex, -1);
  assert.equal(preStartRepairIndex < startIndex, true);
  assert.equal(postStartRepairIndex < waitIndex, true);
  assert.match(source, /AgentOS prepared Gateway local mode and token auth before first Gateway start/);
  assert.match(source, /AgentOS repaired missing Gateway local config after the first start attempt/);
});

test("planner provisioning writes stay behind the OpenClaw adapter", () => {
  const source = readFileSync(path.join(rootDir, "lib/openclaw/planner.ts"), "utf8");

  assert.doesNotMatch(source, /from\s+["']@\/lib\/openclaw\/cli["']/);
  assert.doesNotMatch(source, /runOpenClaw/);
  assert.match(source, /getOpenClawAdapter\(\)\.provisionChannelAccount/);
  assert.match(source, /getOpenClawAdapter\(\)\.provisionAutomation/);
});

test("Gateway compatibility aliases stay centralized outside application services", () => {
  const compatibilitySource = readFileSync(
    path.join(rootDir, "lib/openclaw/client/gateway-compatibility.ts"),
    "utf8"
  );
  const capabilitySource = readFileSync(
    path.join(rootDir, "lib/openclaw/application/capability-matrix-service.ts"),
    "utf8"
  );
  const nativeClientSource = readFileSync(
    path.join(rootDir, "lib/openclaw/client/native-ws-gateway-client.ts"),
    "utf8"
  );

  assert.match(compatibilitySource, /models\.authOrder\.set/);
  assert.match(compatibilitySource, /models\.auth\.order\.set/);
  assert.match(compatibilitySource, /agentIdentity/);
  assert.match(compatibilitySource, /deviceApproval/);
  assert.match(compatibilitySource, /channelProvisioning/);
  assert.match(compatibilitySource, /channelRemoval/);
  assert.match(compatibilitySource, /gmailProvisioning/);
  assert.match(compatibilitySource, /automationProvisioning/);
  assert.match(compatibilitySource, /label: "Model auth order"/);
  assert.match(compatibilitySource, /getOpenClawGatewayOperationLabel/);
  assert.doesNotMatch(capabilitySource, /const knownGatewayFirstMethods = \[/);
  assert.match(capabilitySource, /OPENCLAW_GATEWAY_COMPATIBILITY_OPERATIONS/);
  assert.match(capabilitySource, /buildGatewayMethodContractAudit/);
  assert.match(capabilitySource, /getOpenClawGatewayOperationLabel\(entry\.operation\)/);
  assert.match(nativeClientSource, /gatewayFirstCompatible/);
  assert.match(nativeClientSource, /getOpenClawGatewayMethodCandidates/);
});

test("settings gateway card exposes method contract audit and readable fallback operations", () => {
  const source = readFileSync(path.join(rootDir, "components/mission-control/settings-control-center.tsx"), "utf8");

  assert.match(source, /\["Compatibility", formatGatewayCompatibilityStatus\(gatewayCompatibilityProfile\)\]/);
  assert.match(source, /\["Contract audit", formatGatewayMethodContractStatus\(gatewayCompatibilityProfile\?\.methodContract\)\]/);
  assert.match(source, /\["Contract gaps", formatGatewayMethodContractGaps\(gatewayCompatibilityProfile\?\.methodContract, capabilityMatrix\?\.operations\)\]/);
  assert.match(source, /\["Native ops", formatGatewayOperationCounts\(gatewayCompatibilityProfile\)\]/);
  assert.match(source, /\["Alias ops", formatGatewayAliasOperations\(gatewayCompatibilityProfile\?\.aliasOperations, capabilityMatrix\?\.operations\)\]/);
  assert.match(source, /\["Fallback ops", formatGatewayDegradedOperations\(gatewayCompatibilityProfile\?\.degradedOperations, capabilityMatrix\?\.operations\)\]/);
  assert.match(source, /formatGatewayOperationList/);
  assert.match(source, /Gateway fallback diagnostics/);
  assert.match(source, /diagnostic\.operationLabel/);
});

test("CLI runtime event subscriptions fail closed instead of pretending to stream", () => {
  const source = readFileSync(path.join(rootDir, "lib/openclaw/client/cli-gateway-client.ts"), "utf8");

  assert.match(source, /subscribeRuntimeEvents/);
  assert.match(source, /require the native Gateway transport/);
  assert.doesNotMatch(source, /subscribeRuntimeEvents[\s\S]*return\s+\{\s*close\(\)/);
});

test("CLI mission dispatch fallback bounds OpenClaw agent execution", () => {
  const runnerSource = readFileSync(path.join(rootDir, "scripts/openclaw-mission-dispatch-runner.mjs"), "utf8");
  const lifecycleSource = readFileSync(path.join(rootDir, "lib/openclaw/domains/mission-dispatch-lifecycle.ts"), "utf8");

  assert.match(lifecycleSource, /OPENCLAW_AGENT_TIMEOUT_SECONDS/);
  assert.match(runnerSource, /process\.env\.OPENCLAW_BIN \|\| "openclaw"/);
  assert.match(runnerSource, /"--timeout",\s*String\(timeoutSeconds\)/);
  assert.match(runnerSource, /OpenClaw mission timed out after/);
  assert.match(runnerSource, /SIGKILL/);
});

test("generated Telegram delegation helper uses configured OpenClaw binary and timeout", () => {
  const source = readFileSync(path.join(rootDir, "lib/openclaw/domains/agent-provisioning.ts"), "utf8");

  assert.match(source, /process\.env\.OPENCLAW_BIN \|\| "openclaw"/);
  assert.match(source, /"--timeout",\s*String\(timeoutSeconds\)/);
  assert.match(source, /timeout: timeoutSeconds \* 1000 \+ 15000/);
  assert.doesNotMatch(source, /execFileAsync\("openclaw", args/);
});

test("full uninstall reset avoids OpenClaw-dependent workspace cleanup", () => {
  const source = readFileSync(path.join(rootDir, "lib/openclaw/reset.ts"), "utf8");

  assert.match(
    source,
    /if \(fullUninstall\) \{\s*await removeWorkspaceFolderDirectly\(workspace, emit\);\s*continue;\s*\}\s*await deleteWorkspaceProject/
  );
  assert.match(
    source,
    /if \(fullUninstall\) \{\s*await removeWorkspaceIntegrationDirectory\(workspace, emit\);\s*continue;\s*\}\s*const snapshot = await getMissionControlSnapshot/
  );
  assert.match(source, /OpenClaw uninstall command failed\. AgentOS will continue with local state cleanup/);
  assert.match(source, /Snapshot refresh skipped after full uninstall/);
});

test("AgentOS does not seed legacy openai-codex model refs in production code", () => {
  const offenders = [
    path.join(rootDir, "app/api/models/providers/route.ts"),
    path.join(rootDir, "lib/openclaw/fallback.ts")
  ]
    .filter((filePath) => readFileSync(filePath, "utf8").includes("openai-codex/gpt-"))
    .map(toProjectPath);

  assert.deepEqual(offenders, []);
});

test("OpenClaw local module imports do not introduce cycles", () => {
  const files = readProjectSourceFiles(["lib/openclaw"]);
  const fileSet = new Set(files.map(toProjectPath));
  const graph = new Map<string, string[]>();

  for (const filePath of files) {
    const source = readFileSync(filePath, "utf8");
    const imports: string[] = [];
    const importPattern =
      /import(?:[\s\S]*?from\s*)?["']([^"']+)["']|export\s+\{[\s\S]*?\}\s+from\s*["']([^"']+)["']/g;
    let match: RegExpExecArray | null;

    while ((match = importPattern.exec(source))) {
      const specifier = match[1] ?? match[2];
      const resolved = resolveLocalOpenClawImport(filePath, specifier);

      if (resolved && fileSet.has(resolved)) {
        imports.push(resolved);
      }
    }

    graph.set(toProjectPath(filePath), imports);
  }

  const cycles = findCycles(graph);

  assert.deepEqual(cycles, []);
});

test("sidebar exposes config-driven mission and admin navigation routes", () => {
  const source = readFileSync(path.join(rootDir, "components/mission-control/sidebar.tsx"), "utf8");

  assert.match(source, /type SidebarSection = "overview" \| "operations" \| "system";/);
  assert.match(source, /type SidebarItem = \{[\s\S]*?href\?: string;[\s\S]*?icon: LucideIcon;[\s\S]*?section: SidebarSection;/);
  assert.match(source, /const sidebarItems: SidebarItem\[] = \[/);
  assert.match(source, /\{ label: "Mission Control", href: "\/", icon: Gauge, section: "overview" \}/);
  assert.match(source, /\{ label: "Agents", href: "\/agents", icon: Bot, section: "operations" \}/);
  assert.match(source, /\{ label: "Tasks", href: "\/tasks", icon: ClipboardList, section: "operations" \}/);
  assert.match(source, /\{ label: "Files", href: "\/files", icon: FileText, section: "operations" \}/);
  assert.match(source, /\{ label: "Models", href: "\/models", icon: Cpu, section: "operations" \}/);
  assert.match(source, /\{ label: "Integrations", href: "\/integrations", icon: Plug, section: "operations" \}/);
  assert.match(source, /\{ label: "Settings", href: "\/settings", icon: Settings2, section: "system" \}/);
  assert.match(source, /\{ label: "Diagnostics", href: "\/settings#diagnostics", hash: "diagnostics", icon: TerminalSquare, section: "system" \}/);
  assert.match(source, /onOpenWorkspaceCreate: \(\) => void;/);
  assert.match(source, /<span className="block truncate text-\[0\.82rem\] font-medium">Create Workspace<\/span>/);
  assert.match(source, /onOpenWorkspaceCreate\(\);[\s\S]*?setOpen\(false\);/);
  assert.doesNotMatch(source, /label: "Sessions"/);
  assert.doesNotMatch(source, /label: "Billing"/);
  assert.doesNotMatch(source, /label: "Audit Logs"/);
});

test("sidebar resolves active nav items from path and hash", () => {
  const source = readFileSync(path.join(rootDir, "components/mission-control/sidebar.tsx"), "utf8");

  assert.match(source, /const \[activeHash, setActiveHash\] = useState\(""\);/);
  assert.match(source, /const syncHash = \(\) => setActiveHash\(window\.location\.hash\.replace/);
  assert.match(source, /window\.addEventListener\("hashchange", syncHash\)/);
  assert.match(source, /function isSidebarItemActive\(item: SidebarItem, pathname: string, activeHash: string\)/);
  assert.match(source, /item\.label === "Mission Control"/);
  assert.match(source, /pathname === "\/" && Boolean\(item\.hash\) && activeHash === item\.hash/);
});

test("settings shell no longer hardcodes a light-only wrapper", () => {
  const source = readFileSync(path.join(rootDir, "components/mission-control/mission-control-shell.tsx"), "utf8");

  assert.match(
    source,
    /className=\{cn\([\s\S]*?"mission-shell relative min-h-screen overflow-hidden"[\s\S]*?surfaceTheme === "light" && "mission-shell--light"/
  );
  assert.match(source, /<SettingsControlCenter \{\.\.\.settingsPanelProps\} sidebarOpen=\{isSidebarOpen\} \/>/);
  assert.match(source, /collapsed=\{!isSidebarOpen\}[\s\S]*?settingsMode/);
  assert.match(source, /isSidebarOpen \? "lg:left-\[316px\]" : "lg:left-\[80px\]"/);
});

test("mission shell opens the sidebar on hover and closes it on exit", () => {
  const source = readFileSync(path.join(rootDir, "components/mission-control/mission-control-shell.tsx"), "utf8");

  assert.match(source, /const \[isSidebarOpen, setIsSidebarOpen\] = useState\(false\);/);
  assert.match(source, /onMouseEnter=\{\(\) => setIsSidebarOpen\(true\)\}/);
  assert.match(source, /onMouseLeave=\{\(\) => setIsSidebarOpen\(false\)\}/);
  assert.match(source, /onFocusCapture=\{\(\) => setIsSidebarOpen\(true\)\}/);
  assert.match(
    source,
    /onBlurCapture=\{\(event\) => \{\s*if \(!event\.currentTarget\.contains\(event\.relatedTarget as Node \| null\)\) \{\s*setIsSidebarOpen\(false\);/
  );
  assert.doesNotMatch(source, /sidebarOpenStorageKey/);
});

test("command bar collapses when empty on mobile and desktop", () => {
  const source = readFileSync(path.join(rootDir, "components/mission-control/command-bar.tsx"), "utf8");

  assert.match(source, /const isComposerEmpty =\s*!isComposerActive[\s\S]*?composeSuggestion === null;/);
  assert.match(source, /const isDesktopCollapsed =[\s\S]*?isDesktopLayout[\s\S]*?isComposerEmpty;/);
  assert.match(source, /const isMobileCollapsed =[\s\S]*?!isDesktopLayout[\s\S]*?!isDockHovered[\s\S]*?isComposerEmpty;/);
  assert.match(source, /shouldForceCollapsedComposer \|\| isDesktopCollapsed \|\| isMobileCollapsed/);
  assert.match(source, /shouldRenderCollapsedComposer && "max-w-\[360px\]"/);
});

test("settings control center exposes hash navigation for subpages", () => {
  const source = readFileSync(path.join(rootDir, "components/mission-control/settings-control-center.tsx"), "utf8");

  assert.match(source, /type SettingsSectionId =[\s\S]*?\| "diagnostics"[\s\S]*?\| "advanced"/);
  assert.match(source, /const settingsSections: SettingsSection\[] = \[/);
  assert.match(source, /\{ id: "gateway", label: "Gateway", icon: ShieldCheck \}/);
  assert.match(source, /\{ id: "diagnostics", label: "Diagnostics", icon: TerminalSquare \}/);
  assert.match(source, /aria-label="Settings sections"/);
  assert.match(source, /href=\{`\/settings#\$\{section\.id\}`\}/);
  assert.match(source, /onClick=\{\(\) => \{[\s\S]*?setActiveSection\(section\.id\);[\s\S]*?scrollSettingsToTop\(\);[\s\S]*?\}\}/);
  assert.match(source, /case "diagnostics":\s*return "diagnostics";/);
  assert.doesNotMatch(source, /id: "billing"/);
  assert.doesNotMatch(source, /id: "audit-logs"/);
});

test("sidebar keeps diagnostics out of the premium navigation surface", () => {
  const source = readFileSync(path.join(rootDir, "components/mission-control/sidebar.tsx"), "utf8");

  assert.match(source, /function resolveStatusTone\(/);
  assert.doesNotMatch(source, /snapshot\.diagnostics\.issues/);
  assert.doesNotMatch(source, /resolveSidebarDiagnosticIssue/);
  assert.doesNotMatch(source, /Gateway-first request fell back to CLI/);
  assert.doesNotMatch(source, /visibleDiagnosticIssue/);
});

test("mission control snapshot does not call Gateway config.get for remote url", () => {
  const source = readFileSync(
    path.join(rootDir, "lib/openclaw/application/mission-control/payload-loader.ts"),
    "utf8"
  );

  assert.match(source, /readFile\(path\.join\(openClawStateRootPath, "openclaw\.json"\), "utf8"\)/);
  assert.match(source, /readNestedConfigValue\(config, gatewayRemoteUrlConfigKey\)/);
  assert.doesNotMatch(source, /call<unknown>\("config\.get", \{\}, \{ timeoutMs: 5_000 \}\)/);
});

test("settings control center renders a single hash-selected section", () => {
  const source = readFileSync(path.join(rootDir, "components/mission-control/settings-control-center.tsx"), "utf8");

  assert.match(source, /type SettingsSectionId =[\s\S]*?"danger-zone";/);
  assert.match(source, /const \[activeSection, setActiveSection\] = useState<SettingsSectionId>\(\(\) => resolveInitialSettingsSection\(\)\)/);
  assert.match(source, /window\.addEventListener\("hashchange", syncActiveSectionFromHash\)/);
  assert.doesNotMatch(source, /\bGeneral\b/);
});

test("update check treats loading registry status as loading instead of up to date", () => {
  const source = readFileSync(path.join(rootDir, "components/mission-control/mission-control-shell.tsx"), "utf8");

  assert.match(source, /const isUpdateRegistryLoading =/);
  assert.match(source, /toast\.message\("Update registry is still loading\."/,);
  assert.match(source, /if \(isUpdateRegistryLoading\) \{/);
});

test("diagnostics command stats count the visible recent command window", () => {
  const source = readFileSync(path.join(rootDir, "components/mission-control/settings-control-center.tsx"), "utf8");

  assert.match(source, /snapshot\.diagnostics\.transport/);
  assert.match(source, /<TransportDiagnosticsPanel summary=\{transportSummary\}/);
  assert.match(source, /const latestCommands = commandHistory\.slice\(0, 6\);/);
  assert.match(source, /ok: latestCommands\.filter\(\(command\) => command\.status === "ok"\)\.length/);
  assert.match(source, /failed: latestCommands\.filter\(\(command\) => command\.status !== "ok"\)\.length/);
});

test("onboarding provider flow skips discovery when provider models already exist", () => {
  const source = readFileSync(path.join(rootDir, "components/mission-control/openclaw-onboarding-provider-flow.tsx"), "utf8");

  assert.match(source, /hasVisibleModelsForProvider\(providerId\)/);
  assert.match(source, /result\.connection\.connected &&[\s\S]*autoDiscover &&[\s\S]*!hasVisibleModelsForProvider\(providerId\)/);
  assert.match(source, /shouldDiscover \? "discovering" : "idle"/);
});

test("onboarding runtime step only shows checking while setup is running", () => {
  const source = readFileSync(path.join(rootDir, "components/mission-control/openclaw-onboarding.stages.tsx"), "utf8");

  assert.match(source, /const isChecking = step\.state === "current" && run\.runState === "running";/);
  assert.match(source, /isRuntimeStep[\s\S]*\? "Needs verification"/);
  assert.doesNotMatch(source, /run\.runState === "running" \|\| isRuntimeStep/);
});

test("onboarding refreshes full model snapshot before entering model setup", () => {
  const source = readFileSync(path.join(rootDir, "components/mission-control/mission-control-shell.tsx"), "utf8");

  assert.match(source, /const refreshOnboardingModelSnapshot = useCallback/);
  assert.match(source, /await refreshOnboardingModelSnapshot\(event\.snapshot \?\? null\)/);
  assert.match(source, /const continueToModelSetup = \(\) => \{/);
  assert.match(source, /onContinueToModels=\{continueToModelSetup\}/);
  assert.doesNotMatch(source, /onContinueToModels=\{\(\) => setOnboardingStage\("models"\)\}/);
});

test("model onboarding verifies delayed default model writes before surfacing Gateway timeout", () => {
  const source = readFileSync(path.join(rootDir, "app/api/onboarding/models/route.ts"), "utf8");
  const timeoutCheckIndex = source.indexOf("Gateway response timed out. Checking whether OpenClaw applied the default model");
  const failIndex = source.indexOf('await fail("configuring-default", gatewayError');

  assert.notEqual(timeoutCheckIndex, -1);
  assert.notEqual(failIndex, -1);
  assert.equal(timeoutCheckIndex < failIndex, true);
  assert.match(source, /waitForDefaultModelAfterGatewaySettle/);
  assert.match(source, /Default model verified after a delayed OpenClaw Gateway response/);
  assert.match(source, /isLikelyDelayedGatewaySettleError/);
});

test("full uninstall reset reopens onboarding at system setup", () => {
  const source = readFileSync(path.join(rootDir, "components/mission-control/mission-control-shell.tsx"), "utf8");

  assert.match(source, /const \[requiresFreshInstallSystemSetup, setRequiresFreshInstallSystemSetup\] = useState\(false\);/);
  assert.match(source, /const effectiveOnboardingStage = resolveEffectiveWizardStage/);
  assert.match(source, /setRequiresFreshInstallSystemSetup\(true\);[\s\S]*setOnboardingStage\("system"\);/);
  assert.match(source, /stage=\{effectiveOnboardingStage\}/);
  assert.match(source, /systemSetupRequired=\{requiresFreshInstallSystemSetup\}/);
});

function resolveLocalOpenClawImport(filePath: string, specifier: string) {
  if (specifier.startsWith("@/")) {
    return `${specifier.slice(2)}.ts`;
  }

  if (!specifier.startsWith(".")) {
    return null;
  }

  return `${toProjectPath(path.resolve(path.dirname(filePath), specifier))}.ts`;
}

function findCycles(graph: Map<string, string[]>) {
  const cycles: string[][] = [];
  const seen = new Set<string>();
  const active = new Set<string>();
  const stack: string[] = [];

  function visit(node: string) {
    seen.add(node);
    active.add(node);
    stack.push(node);

    for (const next of graph.get(node) ?? []) {
      if (!seen.has(next)) {
        visit(next);
        continue;
      }

      if (active.has(next)) {
        cycles.push([...stack.slice(stack.indexOf(next)), next]);
      }
    }

    stack.pop();
    active.delete(node);
  }

  for (const node of graph.keys()) {
    if (!seen.has(node)) {
      visit(node);
    }
  }

  return cycles.map((cycle) => cycle.join(" -> ")).sort();
}

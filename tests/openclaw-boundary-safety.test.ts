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
    "lib/openclaw/client/cli-gateway-client.ts",
    "lib/openclaw/domains/agent-config.ts",
    "lib/openclaw/domains/channels.ts",
    "lib/openclaw/application/model-auth-service.ts",
    "lib/openclaw/application/settings-service.ts",
    "lib/openclaw/planner.ts",
    "lib/openclaw/surface-adapters.ts"
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
    "lib/openclaw/domains/agent-config.ts",
    "lib/openclaw/domains/agent-provisioning.ts",
    "lib/openclaw/application/model-auth-service.ts",
    "lib/openclaw/planner.ts",
    "lib/openclaw/reset.ts",
    "lib/openclaw/application/channel-service.ts"
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

test("settings mode sidebar routes non-settings sections back to mission control", () => {
  const source = readFileSync(path.join(rootDir, "components/mission-control/sidebar.tsx"), "utf8");

  assert.match(source, /const sidebarOpenStorageKey = "mission-control-sidebar-open";/);
  assert.match(
    source,
    /if \(settingsMode && sectionId !== "settings"\) \{[\s\S]*?globalThis\.localStorage\?\.setItem\(sidebarOpenStorageKey, "true"\);[\s\S]*?router\.push\(`\/#\$\{sectionId\}`\);/
  );
  assert.match(source, /globalThis\.localStorage\?\.setItem\(sidebarOpenStorageKey, "true"\);/);
  assert.match(source, /if \(sectionId === "settings" && !settingsMode\) \{\s*router\.push\("\/settings"\);/);
});

test("root sidebar resolves active section from hash on mount", () => {
  const source = readFileSync(path.join(rootDir, "components/mission-control/sidebar.tsx"), "utf8");

  assert.match(source, /resolveInitialSidebarSection\(settingsMode\)/);
  assert.match(source, /return settingsMode \? "settings" : "workspaces";/);
  assert.match(source, /window\.addEventListener\("hashchange", syncSectionFromHash\)/);
});

test("settings shell no longer hardcodes a light-only wrapper", () => {
  const source = readFileSync(path.join(rootDir, "components/mission-control/mission-control-shell.tsx"), "utf8");

  assert.match(
    source,
    /className=\{cn\([\s\S]*?"mission-shell relative min-h-screen overflow-hidden"[\s\S]*?surfaceTheme === "light" && "mission-shell--light"/
  );
});

test("mission shell persists sidebar open state across navigation", () => {
  const source = readFileSync(path.join(rootDir, "components/mission-control/mission-control-shell.tsx"), "utf8");

  assert.match(source, /const sidebarOpenStorageKey = "mission-control-sidebar-open";/);
  assert.match(source, /const \[isSidebarOpen, setIsSidebarOpen\] = useState\(false\);/);
  assert.match(source, /const storedSidebarOpen = globalThis\.localStorage\?\.getItem\(sidebarOpenStorageKey\);/);
  assert.match(source, /if \(storedSidebarOpen === "true"\) \{\s*setIsSidebarOpen\(true\);/);
  assert.match(source, /globalThis\.localStorage\?\.setItem\(sidebarOpenStorageKey, String\(isSidebarOpen\)\);/);
});

test("sidebar keeps transient compatibility diagnostics out of the health card", () => {
  const source = readFileSync(path.join(rootDir, "components/mission-control/sidebar.tsx"), "utf8");

  assert.match(source, /const visibleDiagnosticIssue = resolveSidebarDiagnosticIssue\(snapshot\.diagnostics\.issues\);/);
  assert.match(source, /Reusing the last successful payload while a slow OpenClaw command refreshes in the background/);
  assert.match(source, /Gateway-first request fell back to CLI/);
  assert.match(source, /unsupported/);
  assert.match(source, /sessions\\.list\|status\|health/);
  assert.match(source, /gateway\\.config\\.\(\?:patch\|apply\|set\|unset\)/);
  assert.match(source, /unknown method:/);
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

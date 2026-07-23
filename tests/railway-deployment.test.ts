import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { resolveAgentOsDeploymentCapabilities } from "@/lib/agentos/deployment-capabilities";
import { isRailwayManagedRuntime } from "@/lib/openclaw/deployment-runtime";

const rootDir = process.cwd();

test("Railway config uses the dedicated container and liveness endpoint", async () => {
  const config = JSON.parse(await read("railway.json")) as {
    build?: { builder?: string; dockerfilePath?: string };
    deploy?: {
      healthcheckPath?: string;
      restartPolicyType?: string;
      drainingSeconds?: number;
    };
  };

  assert.equal(config.build?.builder, "DOCKERFILE");
  assert.equal(config.build?.dockerfilePath, "Dockerfile.railway");
  assert.equal(config.deploy?.healthcheckPath, "/api/health");
  assert.equal(config.deploy?.restartPolicyType, "ON_FAILURE");
  assert.equal(config.deploy?.drainingSeconds, 30);
  const healthRoute = await read("app/api/health/route.ts");
  assert.match(healthRoute, /127\.0\.0\.1:18789\/healthz/);
  assert.doesNotMatch(healthRoute, /\/readyz/);
});

test("Railway image pins OpenClaw, avoids service-bound cache mounts, and maps every mutable runtime root to the volume", async () => {
  const dockerfile = await read("Dockerfile.railway");

  assert.match(dockerfile, /ghcr\.io\/openclaw\/openclaw:2026\.6\.11@sha256:[a-f0-9]{64}/);
  assert.doesNotMatch(dockerfile, /--mount=type=cache/);
  assert.match(dockerfile, /AGENTOS_RUNTIME_DIR=\/data\/agentos/);
  assert.match(dockerfile, /AGENTOS_SUPERVISOR_SOCKET_PATH=\/tmp\/agentos-supervisor\.sock/);
  assert.match(dockerfile, /AGENTOS_BROWSER_PROFILE_ROOT=\/data\/browser-profiles/);
  assert.match(dockerfile, /secure-browser-worker\.mjs/);
  assert.match(dockerfile, /secure-browser-integration-smoke\.mjs/);
  assert.match(dockerfile, /openclaw-plugins\/agentos-browser-policy/);
  assert.match(dockerfile, /runtime-extras\/node_modules\/ws/);
  assert.match(dockerfile, /novnc/);
  assert.match(dockerfile, /x11vnc/);
  assert.match(dockerfile, /xvfb/);
  assert.match(dockerfile, /OPENCLAW_STATE_DIR=\/data\/openclaw/);
  assert.doesNotMatch(dockerfile, /EXPOSE\s+3000/);
  assert.match(dockerfile, /\/data\/agentos\/mission-control/);
  assert.match(dockerfile, /\/data\/workspaces/);
  assert.match(dockerfile, /gosu/);
});

test("Railway supervisor keeps Gateway private, exposes a locked-down control socket, and excludes the bootstrap password", async () => {
  const supervisor = await read("scripts/railway-supervisor.mjs");
  const entrypoint = await read("scripts/railway-entrypoint.sh");
  const dockerfile = await read("Dockerfile.railway");

  assert.match(supervisor, /delete gatewayEnv\.AGENTOS_INITIAL_ADMIN_PASSWORD/);
  assert.match(supervisor, /bootstrapRailwayOpenClawConfig\(gatewayEnv\)/);
  assert.doesNotMatch(supervisor, /PORT:\s*"3000"/);
  assert.match(supervisor, /"--bind",\s*"loopback"/);
  assert.match(supervisor, /"--auth",\s*"token"/);
  assert.doesNotMatch(supervisor, /"--allow-unconfigured"/);
  assert.doesNotMatch(supervisor, /"--token"/);
  assert.match(supervisor, /request\.action !== "restart-gateway"/);
  assert.match(supervisor, /chmod\(supervisorSocketPath, 0o600\)/);
  assert.match(supervisor, /manualRestartCooldownMs/);
  assert.match(supervisor, /A managed Gateway restart is already in progress/);
  assert.match(supervisor, /OpenClaw Gateway restarted successfully and passed liveness checks/);
  assert.match(supervisor, /gatewayRestartDelayMs/);
  assert.match(supervisor, /gatewayHealthFailureThreshold = 3/);
  assert.match(supervisor, /gatewayRestartFailureLimit = 3/);
  assert.match(supervisor, /browserWorkerRestartFailureLimit = 3/);
  assert.match(supervisor, /terminateBrowserWorkerProcessGroup/);
  assert.match(supervisor, /detached: true/);
  assert.match(supervisor, /startRailwayPublicProxy/);
  assert.match(supervisor, /AGENTOS_BROWSER_POLICY_READY_PATH/);
  assert.match(supervisor, /AGENTOS_MISSION_CONTROL_ROOT/);
  assert.match(supervisor, /HOSTNAME: "127\.0\.0\.1"/);
  assert.match(supervisor, /liveness probe failed/);
  assert.match(supervisor, /gatewayLivenessUrl = `http:\/\/127\.0\.0\.1:\$\{gatewayPort\}\/healthz`/);
  assert.doesNotMatch(supervisor, /gatewayReadyUrl|\/readyz/);
  assert.match(supervisor, /restart attempts exhausted/);
  assert.match(supervisor, /AgentOS stopped unexpectedly[\s\S]*process\.exitCode = 1/);
  assert.match(dockerfile, /railway-openclaw-bootstrap\.mjs/);
  assert.match(entrypoint, /export PORT=3000/);
  assert.match(entrypoint, /RAILWAY_VOLUME_MOUNT_PATH:-.*\/data/);
  assert.match(entrypoint, /exec gosu node:node/);
});

test("deployment capabilities separate local desktop actions from Railway headless operation", () => {
  const railway = resolveAgentOsDeploymentCapabilities({ AGENTOS_DEPLOYMENT_PLATFORM: "railway" }, "linux");
  assert.deepEqual(railway, {
    platform: "railway",
    gatewayLifecycle: "supervisor-managed",
    terminalAccess: "unavailable",
    browserAutomation: "server-headless",
    interactiveBrowserLogin: "unavailable",
    existingBrowserSession: "unavailable",
    hostFileActions: "unavailable"
  });

  const local = resolveAgentOsDeploymentCapabilities({}, "darwin");
  assert.equal(local.gatewayLifecycle, "agentos-managed");
  assert.equal(local.terminalAccess, "macos");
  assert.equal(local.interactiveBrowserLogin, "supported");
  assert.equal(local.existingBrowserSession, "supported");
});

test("Railway Gateway control uses supervisor IPC while secure browser login fails closed", async () => {
  const gatewayRoute = await read("app/api/gateway/control/route.ts");
  const managedGateway = await read("lib/openclaw/application/managed-gateway-service.ts");
  const browserRoute = await read("app/api/accounts/browser-profiles/route.ts");
  const runtimeInbox = await read("components/runtime/runtime-inbox.tsx");
  const accounts = await read("components/operations/accounts/accounts-page-content.tsx");

  assert.match(gatewayRoute, /restartManagedRailwayGateway/);
  assert.match(gatewayRoute, /Only a managed Gateway restart is available/);
  assert.match(managedGateway, /createConnection\(\{ path: socketPath \}\)/);
  assert.match(managedGateway, /action: "restart-gateway"/);
  assert.match(browserRoute, /interactiveBrowserLogin === "unavailable"/);
  assert.match(browserRoute, /managed Chromium browser is headless/);
  assert.match(runtimeInbox, /deployment\.gatewayLifecycle === "supervisor-managed"/);
  assert.match(runtimeInbox, /Restart managed gateway/);
  assert.match(runtimeInbox, /Retry connection/);
  assert.match(accounts, /Secure Self-hosted Browser/);
  assert.match(accounts, /Default · Ready/);
  assert.match(accounts, /Agent task dispatch/);
  assert.match(accounts, /profile\.driver !== "existing-session"/);
});

test("Railway secure browser state remains on the persistent volume without public VNC or CDP", async () => {
  const [dockerfile, entrypoint, docs, worker, proxy] = await Promise.all([
    read("Dockerfile.railway"),
    read("scripts/railway-entrypoint.sh"),
    read("docs/secure-browser-accounts.md"),
    read("scripts/secure-browser-worker.mjs"),
    read("scripts/railway-public-proxy.mjs")
  ]);

  assert.match(dockerfile, /OPENCLAW_STATE_DIR=\/data\/openclaw/);
  assert.match(dockerfile, /AGENTOS_RUNTIME_DIR=\/data\/agentos/);
  assert.match(entrypoint, /chmod 0700/);
  assert.match(entrypoint, /\/data\/browser-profiles/);
  assert.doesNotMatch(dockerfile, /EXPOSE\s+(5900|6080|9222|18800)/);
  assert.match(worker, /"--remote-debugging-address=127\.0\.0\.1"/);
  assert.match(worker, /cdpUrl: `http:\/\/127\.0\.0\.1:\$\{input\.httpPort\}\/cdp\/profile\/\$\{profileId\}`/);
  assert.match(worker, /rewriteCdpJson/);
  assert.doesNotMatch(worker, /cdpUrl: `http:\/\/127\.0\.0\.1:\$\{cdpPort\}`/);
  assert.match(worker, /"-localhost"/);
  assert.doesNotMatch(worker, /--no-sandbox/);
  assert.match(worker, /credentials_enable_service: false/);
  assert.match(worker, /download_restrictions: 3/);
  assert.match(worker, /password_manager_enabled: false/);
  assert.match(proxy, /x-agentos-browser-proxy-token/);
  assert.match(proxy, /authorizeAndBridgeLiveView/);
  assert.doesNotMatch(proxy, /5900|9222/);
  assert.match(docs, /Raw VNC and CDP endpoints[\s\S]*have no Railway public port/);
  assert.match(docs, /browser-accounts\.json/);
  assert.match(docs, /Railway volume/);
});

test("Railway blocks every AgentOS Gateway lifecycle command while preserving native Gateway RPC", async () => {
  const nativeClient = await read("lib/openclaw/client/native-ws-gateway-client.ts");

  assert.match(nativeClient, /isRailwayManagedRuntime\(\)/);
  assert.match(nativeClient, /container supervisor owns the Gateway process lifecycle/);
  assert.match(nativeClient, /OpenClaw Gateway \$\{action\} is unavailable from AgentOS in Railway/);
});

test("Railway onboarding observes the managed Gateway without controlling its service lifecycle", async () => {
  const onboardingRoute = await read("app/api/onboarding/route.ts");

  assert.equal(isRailwayManagedRuntime({ AGENTOS_DEPLOYMENT_PLATFORM: "railway" }), true);
  assert.equal(isRailwayManagedRuntime({ AGENTOS_DEPLOYMENT_PLATFORM: " Railway " }), true);
  assert.equal(isRailwayManagedRuntime({ AGENTOS_DEPLOYMENT_PLATFORM: "local" }), false);
  assert.match(onboardingRoute, /OpenClaw Gateway is ready and managed by Railway/);
  assert.match(onboardingRoute, /AgentOS did not run gateway install, start, or restart/);

  const managedGuardIndex = onboardingRoute.indexOf("if (isRailwayManagedRuntime())");
  const localGatewayCommandIndex = onboardingRoute.indexOf('["gateway", "install", "--json"]');
  assert.ok(managedGuardIndex >= 0);
  assert.ok(localGatewayCommandIndex >= 0);
  assert.ok(managedGuardIndex < localGatewayCommandIndex);
});

test("Railway bootstrap script creates an empty model baseline without provider credentials", async () => {
  const bootstrap = await read("scripts/railway-openclaw-bootstrap.mjs");

  assert.match(bootstrap, /flag:\s*"wx"/);
  assert.match(bootstrap, /mode:\s*"local"/);
  assert.match(bootstrap, /models:\s*\{\}/);
  assert.match(bootstrap, /agentos-browser-policy/);
  assert.match(bootstrap, /plugins[\s\S]*load[\s\S]*paths/);
  assert.doesNotMatch(bootstrap, /primary:\s*["']/);
  assert.doesNotMatch(bootstrap, /providers:/);
  assert.doesNotMatch(bootstrap, /apiKey|token:\s*env\.|OPENAI_API_KEY/);
});

async function read(relativePath: string) {
  return await readFile(path.join(rootDir, relativePath), "utf8");
}

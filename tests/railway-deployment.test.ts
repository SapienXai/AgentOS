import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { isRailwayManagedRuntime } from "@/lib/openclaw/deployment-runtime";

const rootDir = process.cwd();

test("Railway config uses the dedicated container and readiness endpoint", async () => {
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
});

test("Railway image pins OpenClaw, avoids service-bound cache mounts, and maps every mutable runtime root to the volume", async () => {
  const dockerfile = await read("Dockerfile.railway");

  assert.match(dockerfile, /ghcr\.io\/openclaw\/openclaw:2026\.6\.11@sha256:[a-f0-9]{64}/);
  assert.doesNotMatch(dockerfile, /--mount=type=cache/);
  assert.match(dockerfile, /AGENTOS_RUNTIME_DIR=\/data\/agentos/);
  assert.match(dockerfile, /OPENCLAW_STATE_DIR=\/data\/openclaw/);
  assert.doesNotMatch(dockerfile, /EXPOSE\s+3000/);
  assert.match(dockerfile, /\/data\/agentos\/mission-control/);
  assert.match(dockerfile, /\/data\/workspaces/);
  assert.match(dockerfile, /gosu/);
});

test("Railway supervisor keeps Gateway private, bootstraps explicit empty model state, and excludes the bootstrap password", async () => {
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
  assert.match(supervisor, /maxGatewayRestartAttempts = 3/);
  assert.match(supervisor, /OpenClaw Gateway stopped unexpectedly[\s\S]*Restarting/);
  assert.match(supervisor, /OpenClaw Gateway restarted successfully/);
  assert.match(supervisor, /AgentOS stopped unexpectedly[\s\S]*process\.exitCode = 1/);
  assert.match(dockerfile, /railway-openclaw-bootstrap\.mjs/);
  assert.match(entrypoint, /RAILWAY_VOLUME_MOUNT_PATH:-.*\/data/);
  assert.match(entrypoint, /exec gosu node:node/);
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
  assert.doesNotMatch(bootstrap, /primary:\s*["']/);
  assert.doesNotMatch(bootstrap, /providers:/);
  assert.doesNotMatch(bootstrap, /apiKey|token:\s*env\.|OPENAI_API_KEY/);
});

async function read(relativePath: string) {
  return await readFile(path.join(rootDir, relativePath), "utf8");
}

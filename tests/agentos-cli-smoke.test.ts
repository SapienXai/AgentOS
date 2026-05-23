import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { chmod, cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const rootDir = process.cwd();
const realCliPath = path.join(rootDir, "packages", "agentos", "bin", "agentos.js");
const realPackageJsonPath = path.join(rootDir, "packages", "agentos", "package.json");
const packageJson = JSON.parse(readFileSync(realPackageJsonPath, "utf8")) as {
  name: string;
  version: string;
};

test("agentos --version prints the published package version", async () => {
  const fixture = await createCliFixture();
  const result = runCli(fixture.cliPath, ["--version"], {
    env: createSmokeEnv(fixture.installRoot)
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), packageJson.version);
});

test("agentos doctor prints deterministic package, install, node, platform, bundle, env, and OpenClaw diagnostics", async () => {
  const fixture = await createCliFixture();
  const result = runCli(fixture.cliPath, ["doctor"], {
    env: createSmokeEnv(fixture.installRoot)
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, new RegExp(`OK\\s+Package: ${escapeRegExp(packageJson.name)}@${escapeRegExp(packageJson.version)}`));
  assert.match(result.stdout, /OK\s+Install: source checkout/);
  assert.match(result.stdout, /OK\s+Node\.js: v\d+\.\d+\.\d+ \(required >= 20\.9\.0\)/);
  assert.match(result.stdout, /OK\s+Platform:/);
  assert.match(result.stdout, /OK\s+Bundle: ready at /);
  assert.match(result.stdout, /OK\s+Target URL: http:\/\/localhost:3000/);
  assert.match(result.stdout, /OK\s+Configured env: AGENTOS_HOST=127\.0\.0\.1, AGENTOS_PORT=3000, AGENTOS_OPEN=0/);
  assert.match(result.stdout, /WARN\s+OpenClaw: not found in PATH or default local install paths/);
});

test("agentos doctor detects an explicit OpenClaw binary outside PATH", async () => {
  const fixture = await createCliFixture();
  const fakeOpenClaw = await writeFakeOpenClawBinary(fixture.installRoot);
  const result = runCli(fixture.cliPath, ["doctor"], {
    env: {
      ...createSmokeEnv(fixture.installRoot),
      OPENCLAW_BIN: fakeOpenClaw
    }
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    new RegExp(`OK\\s+OpenClaw: OpenClaw 0\\.0\\.0-test at ${escapeRegExp(fakeOpenClaw)}`)
  );
});

test("agentos start and stop maintain runtime state without real OpenClaw", async () => {
  const fixture = await createCliFixture();
  const port = allocateSmokePort();
  const env = createSmokeEnv(fixture.installRoot);
  const statePath = path.join(fixture.installRoot, "run", `agentos-${port}.json`);
  let startProcess: ChildProcessWithoutNullStreams | null = null;

  try {
    startProcess = spawn(process.execPath, [
      fixture.cliPath,
      "start",
      "--port",
      String(port),
      "--host",
      "127.0.0.1",
      "--no-open"
    ], { env });

    const output = collectProcessOutput(startProcess);
    const state = await waitForRuntimeState(statePath);

    assert.equal(state.port, port);
    assert.equal(state.host, "127.0.0.1");
    assert.equal(typeof state.pid, "number");
    await waitFor(() => new RegExp(`Starting AgentOS on http://localhost:${port}`).test(output()) ? true : null, 2_000);

    const stopResult = runCli(fixture.cliPath, ["stop", "--port", String(port)], { env });

    assert.equal(stopResult.status, 0, stopResult.stderr);
    assert.match(stopResult.stdout, new RegExp(`Stopped AgentOS on port ${port}|Cleared stale AgentOS runtime state for port ${port}`));
    await waitForProcessExit(startProcess);
    assert.equal(existsSync(statePath), false);
  } finally {
    if (startProcess && startProcess.exitCode === null && startProcess.signalCode === null) {
      startProcess.kill("SIGTERM");
      await waitForProcessExit(startProcess).catch(() => undefined);
    }
  }
});

test("agentos start scrubs package runtime env files before launching the bundle", async () => {
  const fixture = await createCliFixture();
  const port = allocateSmokePort();
  const env = createSmokeEnv(fixture.installRoot);
  const bundledEnvPath = path.join(fixture.packageDir, "bundle", ".env.local");
  let startProcess: ChildProcessWithoutNullStreams | null = null;

  await writeFile(bundledEnvPath, "AGENTOS_OPENCLAW_GATEWAY_TOKEN=\"stale-token\"\n", "utf8");

  try {
    startProcess = spawn(process.execPath, [
      fixture.cliPath,
      "start",
      "--port",
      String(port),
      "--host",
      "127.0.0.1",
      "--no-open"
    ], { env });

    const output = collectProcessOutput(startProcess);
    await waitForRuntimeState(path.join(fixture.installRoot, "run", `agentos-${port}.json`));
    await waitFor(() => /Package runtime: 1/.test(output()) ? true : null, 2_000);

    assert.equal(existsSync(bundledEnvPath), false);
    assert.match(output(), new RegExp(`Runtime dir: ${escapeRegExp(fixture.installRoot)}`));

    const stopResult = runCli(fixture.cliPath, ["stop", "--port", String(port)], { env });
    assert.equal(stopResult.status, 0, stopResult.stderr);
    await waitForProcessExit(startProcess);
  } finally {
    if (startProcess && startProcess.exitCode === null && startProcess.signalCode === null) {
      startProcess.kill("SIGTERM");
      await waitForProcessExit(startProcess).catch(() => undefined);
    }
  }
});

test("package-manager update --check prints package manager guidance without network", async () => {
  const fixture = await createCliFixture({
    packageDir: path.join(await mkdtemp(path.join(os.tmpdir(), "agentos-pm-fixture-")), "node_modules", "@sapienx", "agentos")
  });
  const result = runCli(fixture.cliPath, ["update", "--check"], {
    env: {
      ...createSmokeEnv(fixture.installRoot),
      AGENTOS_TEST_LATEST_VERSION: bumpPatchVersion(packageJson.version)
    }
  });

  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /Update available:/);
  assert.match(result.stdout, /This AgentOS install appears to come from a package manager\./);
  assert.match(result.stdout, /pnpm add -g @sapienx\/agentos@latest/);
  assert.match(result.stdout, /npm install -g @sapienx\/agentos@latest/);
});

test("package-manager uninstall redirects to package manager commands", async () => {
  const fixture = await createCliFixture({
    packageDir: path.join(await mkdtemp(path.join(os.tmpdir(), "agentos-pm-uninstall-")), "node_modules", "@sapienx", "agentos")
  });
  const result = runCli(fixture.cliPath, ["uninstall", "--yes"], {
    env: createSmokeEnv(fixture.installRoot)
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /This AgentOS install appears to come from a package manager\./);
  assert.match(result.stdout, /pnpm remove -g @sapienx\/agentos/);
  assert.match(result.stdout, /npm uninstall -g @sapienx\/agentos/);
});

test("release installer scripts keep expected asset patterns and pass static sanity checks", () => {
  const installSh = readFileSync(path.join(rootDir, "install.sh"), "utf8");
  const installPs1 = readFileSync(path.join(rootDir, "install.ps1"), "utf8");

  if (process.platform !== "win32") {
    const shellCheck = spawnSync("sh", ["-n", path.join(rootDir, "install.sh")], {
      encoding: "utf8"
    });
    assert.equal(shellCheck.status, 0, shellCheck.stderr);
  }

  assert.match(installSh, /ARTIFACT_NAME="agentos-\$\{ASSET_PLATFORM\}-\$\{ASSET_ARCH\}\.tgz"/);
  assert.match(installSh, /RELEASE_PATH="latest\/download"/);
  assert.match(installSh, /RELEASE_PATH="download\/agentos-v\$\{REQUESTED_VERSION\}"/);
  assert.match(installSh, /CHECKSUM_NAME="\$\{ARTIFACT_NAME\}\.sha256"/);
  assert.match(installPs1, /\$assetPlatform = "win32"/);
  assert.match(installPs1, /\$artifactName = "agentos-\$assetPlatform-\$assetArch\.tgz"/);
  assert.match(installPs1, /\$releasePath = "latest\/download"/);
  assert.match(installPs1, /\$releasePath = "download\/agentos-v\$requestedVersion"/);
  assert.match(installPs1, /\$checksumUrl = "\$artifactUrl\.sha256"/);
});

async function createCliFixture(options: { packageDir?: string } = {}) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "agentos-cli-smoke-"));
  const packageDir = options.packageDir ?? path.join(tempRoot, "agentos-source", "packages", "agentos");
  const installRoot = path.join(tempRoot, "install-root");
  const cliPath = path.join(packageDir, "bin", "agentos.js");

  await mkdir(path.join(packageDir, "bin"), { recursive: true });
  await mkdir(path.join(packageDir, "bundle"), { recursive: true });
  await cp(realCliPath, cliPath);
  await writeFile(path.join(packageDir, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");
  await writeFile(path.join(packageDir, "bundle", "server.js"), renderStubServer(), "utf8");

  return {
    cliPath,
    installRoot,
    packageDir
  };
}

function runCli(
  cliPath: string,
  args: string[],
  options: {
    env: NodeJS.ProcessEnv;
  }
) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    env: options.env,
    encoding: "utf8"
  });
}

function createSmokeEnv(installRoot: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    AGENTOS_CLI_TEST: "1",
    AGENTOS_INSTALL_ROOT: installRoot,
    AGENTOS_HOST: "127.0.0.1",
    AGENTOS_PORT: "3000",
    AGENTOS_OPEN: "0",
    PATH: path.join(installRoot, "empty-bin")
  };
}

function renderStubServer() {
  return [
    'import http from "node:http";',
    'if (process.env.AGENTOS_CLI_TEST === "1") {',
    '  console.log("Ready in 1ms");',
    '  console.log(`Package runtime: ${process.env.AGENTOS_PACKAGE_RUNTIME || ""}`);',
    '  console.log(`Runtime dir: ${process.env.AGENTOS_RUNTIME_DIR || ""}`);',
    '  setInterval(() => {}, 1000);',
    '  process.on("SIGTERM", () => process.exit(0));',
    '  process.on("SIGINT", () => process.exit(0));',
    '} else {',
    'const host = process.env.HOSTNAME || "127.0.0.1";',
    "const port = Number(process.env.PORT || 3000);",
    'const server = http.createServer((_request, response) => { response.end("ok"); });',
    'server.listen(port, host, () => { console.log("Ready in 1ms"); });',
    'const shutdown = () => { server.close(() => process.exit(0)); };',
    'process.on("SIGTERM", shutdown);',
    'process.on("SIGINT", shutdown);',
    '}'
  ].join("\n");
}

async function writeFakeOpenClawBinary(installRoot: string) {
  const binDir = path.join(installRoot, "fake-openclaw");
  const binPath = path.join(binDir, process.platform === "win32" ? "openclaw.cmd" : "openclaw");

  await mkdir(binDir, { recursive: true });

  if (process.platform === "win32") {
    await writeFile(binPath, "@echo off\r\necho OpenClaw 0.0.0-test\r\n", "utf8");
    return binPath;
  }

  await writeFile(binPath, "#!/bin/sh\necho OpenClaw 0.0.0-test\n", "utf8");
  await chmod(binPath, 0o755);
  return binPath;
}

function collectProcessOutput(child: ChildProcessWithoutNullStreams) {
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });
  return () => output;
}

async function waitForRuntimeState(statePath: string) {
  return waitFor(async () => {
    const raw = await readFile(statePath, "utf8").catch(() => null);

    if (!raw) {
      return null;
    }

    const state = JSON.parse(raw) as { pid?: unknown; port?: unknown; host?: unknown };
    return typeof state.pid === "number" ? state as { pid: number; port: number; host: string } : null;
  }, 5_000);
}

async function waitForProcessExit(child: ChildProcessWithoutNullStreams) {
  await waitFor(() => child.exitCode !== null || child.signalCode !== null ? true : null, 5_000);
}

async function waitFor<T>(read: () => Promise<T | null> | T | null, timeoutMs: number): Promise<T> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const value = await read();

    if (value) {
      return value;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
  }

  throw new Error(`Timed out after ${timeoutMs}ms.`);
}

function allocateSmokePort() {
  const offset = (Date.now() + process.pid) % 20_000;
  return 30_000 + offset;
}

function bumpPatchVersion(version: string) {
  const [major, minor, patch] = version.split(".").map(Number);
  return `${major}.${minor}.${patch + 1}`;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

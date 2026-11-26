const { spawn } = require("node:child_process");
const { randomBytes } = require("node:crypto");
const { access, lstat, mkdir, mkdtemp, readFile, realpath, writeFile } = require("node:fs/promises");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");
const { Writable } = require("node:stream");
const { createDisposableOpenClawEnvironment } = require("./lib/disposable-openclaw-env.ts");
const { enableInstanceProtection, getInstanceProtectionStatus } = require("../lib/security/instance-protection.ts");

const version = "2026.11.10";
const [versionFlag, candidateVersion, openClawInput, buildInput, resumeInput, ...extraArgs] = process.argv.slice(2);

async function requirePrivateStateEntry(file, kind) {
  const state = await lstat(file);
  const expectedType = kind === "directory" ? state.isDirectory() : state.isFile();
  if (!expectedType || (process.getuid && (state.uid !== process.getuid() || (state.mode & 0o077) !== 0))) {
    throw new Error("Resume requires an owner-only acceptance state directory with private state files.");
  }
}

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject));
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

function readPrivatePassword() {
  if (!process.stdin.isTTY) throw new Error("Launch the acceptance environment from an interactive terminal.");
  process.stdout.write("Choose a password for the disposable acceptance-owner account: ");
  const muted = new Writable({ write(_chunk, _encoding, done) { done(); } });
  const terminal = readline.createInterface({ input: process.stdin, output: muted, terminal: true });
  return new Promise((resolve, reject) => {
    terminal.once("SIGINT", () => {
      terminal.close();
      reject(new Error("Acceptance setup was cancelled."));
    });
    terminal.question("", (answer) => {
      terminal.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

async function waitReady(url, child) {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error("An acceptance process exited during startup.");
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(500) })).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("The local acceptance endpoint did not become ready.");
}

async function main() {
  if (versionFlag !== "--candidate-version" || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(candidateVersion || "") || !openClawInput || !buildInput || extraArgs.length) {
    throw new Error("Usage: node -r ./tests/register-paths.cjs -r jiti/register.js scripts/agentos-owner-acceptance.cjs --candidate-version MAJOR.MINOR.PATCH OPENCLAW_PACKAGE AGENTOS_BUILD_ROOT [ACCEPTANCE_STATE]");
  }
  const packagePath = await realpath(openClawInput);
  const build = await realpath(buildInput);
  const readVersion = async (file) => JSON.parse(await readFile(file, "utf8")).version;
  const actualVersions = await Promise.all([
    readVersion(path.join(packagePath, "package.json")),
    readVersion(path.join(build, "node_modules", "@openclaw", "gateway-client", "package.json")),
    readVersion(path.join(build, "node_modules", "@openclaw", "gateway-protocol", "package.json"))
  ]);
  if (actualVersions.some((value) => value !== version)) {
    throw new Error(`The acceptance environment requires OpenClaw and both Gateway SDK packages at ${version}.`);
  }
  if (await readVersion(path.join(build, "packages", "agentos", "package.json")) !== candidateVersion) {
    throw new Error(`The build does not match the requested AgentOS ${candidateVersion} candidate.`);
  }
  const serverEntry = path.join(build, "node_modules", "next", "dist", "bin", "next");
  const runtimeEntry = path.join(packagePath, "openclaw.mjs");
  await Promise.all([access(serverEntry), access(runtimeEntry), access(path.join(build, ".next", "BUILD_ID"))]);
  for (const file of [".env", ".env.local", ".env.production", ".env.production.local"]) {
    if (await access(path.join(build, file)).then(() => true, () => false)) {
      throw new Error("Use a clean AgentOS production build without dotenv files.");
    }
  }

  const root = resumeInput ? await realpath(resumeInput) : await mkdtemp(path.join(os.tmpdir(), "agentos-owner-acceptance-"));
  const receipt = path.join(root, `agentos-${candidateVersion}-owner-acceptance`);
  const homeDir = path.join(root, "home");
  const stateDir = path.join(root, "openclaw");
  const runtimeDir = path.join(root, "agentos");
  const workspace = path.join(root, "workspace");
  const configPath = path.join(stateDir, "openclaw.json");
  const [gatewayPort, appPort] = await Promise.all([reservePort(), reservePort()]);
  let token;
  if (resumeInput) {
    await Promise.all([
      ...[root, homeDir, stateDir, runtimeDir, workspace].map(dir => requirePrivateStateEntry(dir, "directory")),
      requirePrivateStateEntry(receipt, "file"),
      requirePrivateStateEntry(configPath, "file")
    ]);
    token = (await readFile(receipt, "utf8")).trim();
    if (!/^[a-f0-9]{64}$/.test(token)) throw new Error("The supplied directory is not an initialized acceptance environment.");
  } else {
    await Promise.all([homeDir, stateDir, runtimeDir, workspace].map((dir) => mkdir(dir, { mode: 0o700 })));
    token = randomBytes(32).toString("hex");
    await writeFile(configPath, JSON.stringify({
      gateway: { mode: "local", bind: "loopback", auth: { mode: "token", token } },
      agents: { defaults: { workspace } },
      cron: { enabled: false }
    }), { mode: 0o600, flag: "wx" });
  }
  const gatewayUrl = `ws://127.0.0.1:${gatewayPort}`;
  const env = createDisposableOpenClawEnvironment({ homeDir, overrides: {
    NODE_ENV: "production", HOSTNAME: "127.0.0.1", PORT: String(appPort), TMPDIR: root,
    AGENTOS_RUNTIME_DIR: runtimeDir, AGENTOS_OPENCLAW_GATEWAY_URL: gatewayUrl,
    AGENTOS_OPENCLAW_GATEWAY_TOKEN: token, AGENTOS_PACKAGE_RUNTIME: "1",
    OPENCLAW_STATE_DIR: stateDir, OPENCLAW_CONFIG_PATH: configPath,
    OPENCLAW_GATEWAY_PORT: String(gatewayPort), OPENCLAW_GATEWAY_TOKEN: token, OPENCLAW_BIN: runtimeEntry
  } });
  if (!resumeInput) {
    const password = await readPrivatePassword();
    await enableInstanceProtection({ username: "acceptance-owner", password }, env);
    await writeFile(receipt, token, { mode: 0o600, flag: "wx" });
  }
  const protection = await getInstanceProtectionStatus(null, env);
  if (!protection.protectionEnabled || !protection.credentialConfigured || protection.authenticated) {
    throw new Error("The acceptance state does not have a protected owner account.");
  }
  const children = [];
  const start = (cwd, ...command) => {
    const child = spawn(process.execPath, command, { cwd, env, stdio: "ignore" });
    children.push(child);
    child.once("error", () => { process.exitCode = 1; });
    return child;
  };
  const stop = () => {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    }
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    const gateway = start(root, runtimeEntry, "gateway", "run", "--bind", "loopback", "--port", String(gatewayPort));
    await waitReady(`http://127.0.0.1:${gatewayPort}/healthz`, gateway);
    const app = start(build, serverEntry, "start", "--hostname", "127.0.0.1", "--port", String(appPort));
    await waitReady(`http://127.0.0.1:${appPort}/api/auth/status`, app);
    console.log(`Open http://127.0.0.1:${appPort}/mission-control and sign in as acceptance-owner.`);
    console.log(`Isolated state: ${root}`);
    console.log("Press Ctrl+C to stop. Append the isolated state directory to the same command to resume.");
    await Promise.race(children.map((child) => new Promise((resolve) => child.once("exit", resolve))));
  } finally {
    stop();
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Unable to start owner acceptance.");
  process.exitCode = 1;
});

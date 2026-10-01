import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

// @ts-expect-error This integration test imports the JavaScript supervisor runtime directly.
import { createGatewaySupervisor } from "../scripts/railway-supervisor-runtime.mjs";

test("Gateway supervisor shutdown fences delayed recovery spawns", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentos-supervisor-shutdown-"));
  const fakeGatewayPath = path.join(root, "fake-openclaw.mjs");
  const spawnMarker = path.join(root, "spawns.log");
  const port = await reservePort();
  await writeFile(fakeGatewayPath, `
    import { appendFileSync, readFileSync } from "node:fs";
    import { createServer } from "node:http";
    const marker = process.env.AGENTOS_SPAWN_MARKER;
    const prior = (() => { try { return readFileSync(marker, "utf8").trim().split("\\n").filter(Boolean).length; } catch { return 0; } })();
    appendFileSync(marker, "spawn\\n");
    if (prior === 1) process.exit(17);
    const portIndex = process.argv.indexOf("--port");
    const port = Number(process.argv[portIndex + 1]);
    const server = createServer((_request, response) => { response.writeHead(200); response.end("ok"); });
    server.listen(port, "127.0.0.1");
    process.once("SIGTERM", () => server.close(() => process.exit(0)));
  `, "utf8");

  const supervisor = createGatewaySupervisor({
    binary: fakeGatewayPath,
    port,
    stateDir: path.join(root, "state"),
    configPath: path.join(root, "openclaw.json"),
    token: "disposable-test-token",
    socketPath: path.join(root, "supervisor.sock"),
    environment: { ...process.env, AGENTOS_SPAWN_MARKER: spawnMarker },
    startupTimeoutMs: 2_000,
    readyTimeoutMs: 2_000,
    stopTimeoutMs: 1_000,
    healthIntervalMs: 50,
    healthFailureThreshold: 1,
    restartFailureLimit: 3
  });

  try {
    await supervisor.start();
    const firstPid = supervisor.getStatus().pid;
    assert.ok(firstPid);
    process.kill(firstPid, "SIGKILL");
    await waitUntil(async () => (await readSpawnCount(spawnMarker)) === 2, 5_000);
    await new Promise((resolve) => setTimeout(resolve, 100));

    await supervisor.stop();
    await supervisor.closed;
    await new Promise((resolve) => setTimeout(resolve, 2_200));

    assert.equal(await readSpawnCount(spawnMarker), 2);
    assert.equal(supervisor.getStatus().generation, 2);
    assert.equal(supervisor.getStatus().state, "stopped");
  } finally {
    await supervisor.stop();
    await supervisor.closed;
    await rm(root, { recursive: true, force: true });
  }
});

async function readSpawnCount(marker: string) {
  try {
    return (await readFile(marker, "utf8")).trim().split("\n").filter(Boolean).length;
  } catch {
    return 0;
  }
}

async function waitUntil(predicate: () => Promise<boolean>, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for the disposable Gateway supervisor state.");
}

async function reservePort() {
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

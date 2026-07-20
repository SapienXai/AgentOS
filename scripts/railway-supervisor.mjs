import { spawn } from "node:child_process";
import { bootstrapRailwayOpenClawConfig } from "./railway-openclaw-bootstrap.mjs";

const gatewayPort = 18789;
const gatewayEnv = { ...process.env };
delete gatewayEnv.AGENTOS_INITIAL_ADMIN_PASSWORD;

await bootstrapRailwayOpenClawConfig(gatewayEnv);

const gateway = spawn("openclaw", [
  "gateway",
  "run",
  "--bind",
  "loopback",
  "--auth",
  "token",
  "--compact",
  "--port",
  String(gatewayPort)
], {
  env: gatewayEnv,
  stdio: "inherit"
});

let agentos = null;
let stopping = false;

const stop = (signal = "SIGTERM") => {
  if (stopping) return;
  stopping = true;
  agentos?.kill(signal);
  gateway.kill(signal);
};

process.on("SIGTERM", () => stop("SIGTERM"));
process.on("SIGINT", () => stop("SIGINT"));

gateway.once("error", (error) => {
  console.error(`OpenClaw Gateway could not start: ${error.message}`);
  process.exitCode = 1;
});

try {
  await waitForGateway();
} catch (error) {
  console.error(error instanceof Error ? error.message : "OpenClaw Gateway did not become ready.");
  stop();
  process.exit(1);
}

if (gateway.exitCode !== null) {
  console.error(`OpenClaw Gateway exited before AgentOS started (code ${gateway.exitCode}).`);
  process.exit(1);
}

agentos = spawn(process.execPath, ["/agentos/server.js"], {
  env: process.env,
  stdio: "inherit"
});

agentos.once("error", (error) => {
  console.error(`AgentOS could not start: ${error.message}`);
  stop();
});

const exit = await Promise.race([
  childExit(gateway, "OpenClaw Gateway"),
  childExit(agentos, "AgentOS")
]);

if (!stopping) {
  console.error(`${exit.label} stopped unexpectedly (code ${exit.code ?? "unknown"}).`);
  stop();
}

await Promise.allSettled([childExit(gateway, "OpenClaw Gateway"), childExit(agentos, "AgentOS")]);
process.exit(stopping ? 0 : 1);

async function waitForGateway() {
  const deadline = Date.now() + 120_000;

  while (Date.now() < deadline) {
    if (gateway.exitCode !== null) {
      throw new Error(`OpenClaw Gateway exited during startup (code ${gateway.exitCode}).`);
    }

    try {
      const response = await fetch(`http://127.0.0.1:${gatewayPort}/readyz`, {
        signal: AbortSignal.timeout(1_500)
      });
      if (response.ok) return;
    } catch {
      // The Gateway may still be initializing its persistent state.
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error("OpenClaw Gateway did not become ready within 120 seconds.");
}

function childExit(child, label) {
  if (child.exitCode !== null) {
    return Promise.resolve({ label, code: child.exitCode });
  }

  return new Promise((resolve) => {
    child.once("exit", (code) => resolve({ label, code }));
  });
}

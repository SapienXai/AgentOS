import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { WebSocketServer, type WebSocket } from "ws";

import {
  OPENCLAW_GATEWAY_BASELINE_OPTIONAL_METHODS,
  OPENCLAW_GATEWAY_BASELINE_REQUIRED_METHODS,
  OPENCLAW_KNOWN_GATEWAY_FIRST_METHODS
} from "@/lib/openclaw/client/gateway-compatibility";
import {
  formatOpenClawCompatibilityReleaseSummaryMarkdown,
  formatOpenClawCompatibilityReleaseSummary,
  formatOpenClawCompatibilityReportHuman,
  getOpenClawCompatibilityReport,
  isSimulatedCompatibilityTarget,
  normalizeRuntimeStartedBy,
  resolveDefaultFailOnDegraded,
  resolveOpenClawCompatibilityExit,
  resolveOpenClawCompatibilityTarget
} from "@/lib/openclaw/compat";
import { NativeWsOpenClawGatewayClient } from "@/lib/openclaw/client/gateway-client";
import {
  OPENCLAW_RECOMMENDED_VERSION,
  OPENCLAW_SUPPORTED_BASELINE_VERSION
} from "@/lib/openclaw/versions";
import { redactErrorMessage, redactSecrets } from "@/lib/security/redaction";
import type {
  OpenClawCompatibilityRuntimeStartedBy,
  OpenClawCompatibilityTarget
} from "@/lib/openclaw/compat";

type CompatTarget = string;

type CliOptions = {
  target: CompatTarget;
  gatewayUrl: string | null;
  jsonOutput: string | null;
  summaryOutput: string | null;
  humanOutput: string | null;
  jsonOnly: boolean;
  failOnIncompatible: boolean;
  failOnDegraded: boolean;
  allowDegraded: boolean;
  noShapeChecks: boolean;
  runtimeStartedBy: OpenClawCompatibilityRuntimeStartedBy | null;
  waitTimeoutMs: number;
  retryIntervalMs: number;
};

type GatewayFrame = {
  type?: string;
  id?: string | number;
  method?: string;
  params?: Record<string, unknown>;
};

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const target = resolveOpenClawCompatibilityTarget({
    target: options.target,
    gatewayUrl: options.gatewayUrl,
    runtimeStartedBy: options.runtimeStartedBy
  });
  const failOnDegraded = options.failOnDegraded || (
    !options.allowDegraded && resolveDefaultFailOnDegraded(target)
  );

  if (target.aliasUsed && !options.jsonOnly) {
    process.stderr.write(`Warning: ${target.aliasUsed} is deprecated; use ${target.name}.\n`);
  }

  const testGateway = isSimulatedCompatibilityTarget(target)
    ? await startCompatibilityTestGateway(target)
    : null;

  try {
    if (!testGateway) {
      await waitForRealGatewayReady({
        target,
        gatewayUrl: options.gatewayUrl,
        timeoutMs: options.waitTimeoutMs,
        retryIntervalMs: options.retryIntervalMs,
        nativeTimeoutMs: options.noShapeChecks ? 1_500 : 2_500
      });
    }

    const report = redactSecrets(await getOpenClawCompatibilityReport({
      force: true,
      includeLiveShapeChecks: !options.noShapeChecks,
      ...(testGateway
        ? {
          target: {
            ...target,
            label: testGateway.label,
            version: testGateway.version
          },
          openClawVersionSource: "assumed" as const,
          installedVersion: testGateway.version,
          status: {
            runtimeVersion: testGateway.version,
            version: testGateway.version,
            updateChannel: testGateway.channel
          },
          gatewayStatus: {
            service: {
              label: testGateway.label,
              loaded: true
            },
            gateway: {
              bindMode: "local",
              port: testGateway.port,
              probeUrl: testGateway.url
            },
            rpc: {
              ok: true,
              capability: "protocol v4",
              auth: {
                role: "operator",
                scopes: ["operator.read", "operator.write"],
                capability: "operator"
              }
            }
          },
          cliAvailable: true,
          nativeClientOptions: {
            url: testGateway.url,
            token: "test-token",
            timeoutMs: 1_500
          },
          nativeTimeoutMs: 1_500
        }
        : {
          target,
          nativeClientOptions: {
            ...(options.gatewayUrl ? { url: options.gatewayUrl } : {}),
            timeoutMs: 2_500
          },
          nativeTimeoutMs: 2_500
        })
    }));
    const releaseSummary = formatOpenClawCompatibilityReleaseSummary(report);
    const markdownSummary = formatOpenClawCompatibilityReleaseSummaryMarkdown(report);
    const humanReport = formatOpenClawCompatibilityReportHuman(report);

    if (!options.jsonOnly) {
      process.stdout.write(humanReport);
    }

    const jsonPayload = JSON.stringify({ report, releaseSummary }, null, 2);

    if (options.jsonOutput) {
      const outputPath = path.resolve(options.jsonOutput);
      await mkdir(path.dirname(outputPath), { recursive: true });
      await writeFile(outputPath, `${jsonPayload}\n`, "utf8");
      if (!options.jsonOnly) {
        process.stdout.write(`\nJSON report written to ${outputPath}\n`);
      }
    }

    if (options.summaryOutput) {
      const summaryPath = path.resolve(options.summaryOutput);
      await mkdir(path.dirname(summaryPath), { recursive: true });
      await writeFile(summaryPath, markdownSummary, "utf8");
      if (!options.jsonOnly) {
        process.stdout.write(`Summary written to ${summaryPath}\n`);
      }
    }

    if (options.humanOutput) {
      const humanPath = path.resolve(options.humanOutput);
      await mkdir(path.dirname(humanPath), { recursive: true });
      await writeFile(humanPath, humanReport, "utf8");
      if (!options.jsonOnly) {
        process.stdout.write(`Human report written to ${humanPath}\n`);
      }
    }

    if (options.jsonOnly) {
      process.stdout.write(`${jsonPayload}\n`);
    } else {
      process.stdout.write("\nOPENCLAW_COMPAT_REPORT_JSON_START\n");
      process.stdout.write(`${jsonPayload}\n`);
      process.stdout.write("OPENCLAW_COMPAT_REPORT_JSON_END\n");
    }

    const exitDecision = resolveOpenClawCompatibilityExit({
      report,
      failOnIncompatible: options.failOnIncompatible,
      failOnDegraded,
      allowDegraded: options.allowDegraded
    });

    if (report.status === "degraded" && options.allowDegraded && !options.jsonOnly) {
      process.stderr.write(`Warning: ${exitDecision.reason}\n`);
    }

    if (exitDecision.exitCode !== 0) {
      process.stderr.write(`${exitDecision.reason}\n`);
      process.exitCode = exitDecision.exitCode;
    }
  } finally {
    await testGateway?.close();
  }
}

function parseArgs(args: string[]): CliOptions {
  const parsed: CliOptions = {
    target: "real-local",
    gatewayUrl: process.env.AGENTOS_OPENCLAW_GATEWAY_URL?.trim() || process.env.OPENCLAW_GATEWAY_URL?.trim() || null,
    jsonOutput: null,
    summaryOutput: null,
    humanOutput: null,
    jsonOnly: false,
    failOnIncompatible: true,
    failOnDegraded: false,
    allowDegraded: false,
    runtimeStartedBy: null,
    waitTimeoutMs: 60_000,
    retryIntervalMs: 2_000,
    noShapeChecks: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    switch (arg) {
      case "--":
        break;
      case "--target": {
        const target = args[index + 1] as CompatTarget | undefined;
        if (!target) {
          throw new Error("Expected a target after --target.");
        }
        parsed.target = target;
        index += 1;
        break;
      }
      case "--gateway-url": {
        const gatewayUrl = args[index + 1];
        if (!gatewayUrl) {
          throw new Error("Expected a Gateway URL after --gateway-url.");
        }
        parsed.gatewayUrl = gatewayUrl;
        index += 1;
        break;
      }
      case "--json-output":
      case "--output": {
        const output = args[index + 1];
        if (!output) {
          throw new Error(`Expected a file path after ${arg}.`);
        }
        parsed.jsonOutput = output;
        index += 1;
        break;
      }
      case "--summary-output": {
        const output = args[index + 1];
        if (!output) {
          throw new Error("Expected a file path after --summary-output.");
        }
        parsed.summaryOutput = output;
        index += 1;
        break;
      }
      case "--human-output": {
        const output = args[index + 1];
        if (!output) {
          throw new Error("Expected a file path after --human-output.");
        }
        parsed.humanOutput = output;
        index += 1;
        break;
      }
      case "--json-only":
        parsed.jsonOnly = true;
        break;
      case "--fail-on-incompatible":
        parsed.failOnIncompatible = true;
        break;
      case "--fail-on-degraded":
        parsed.failOnDegraded = true;
        parsed.allowDegraded = false;
        break;
      case "--allow-degraded":
        parsed.allowDegraded = true;
        parsed.failOnDegraded = false;
        break;
      case "--runtime-started-by": {
        const runtimeStartedBy = args[index + 1];
        if (!runtimeStartedBy) {
          throw new Error("Expected ci, script, external, or unknown after --runtime-started-by.");
        }
        parsed.runtimeStartedBy = normalizeRuntimeStartedBy(runtimeStartedBy, "unknown");
        index += 1;
        break;
      }
      case "--wait-timeout-ms": {
        parsed.waitTimeoutMs = parsePositiveIntegerArg(args[index + 1], "--wait-timeout-ms");
        index += 1;
        break;
      }
      case "--retry-interval-ms": {
        parsed.retryIntervalMs = parsePositiveIntegerArg(args[index + 1], "--retry-interval-ms");
        index += 1;
        break;
      }
      case "--no-shape-checks":
        parsed.noShapeChecks = true;
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function printHelp() {
  process.stdout.write(`Usage: pnpm openclaw:compat [options]

Options:
  --target <target>              simulated-stable, simulated-beta-shape, real-local, or real-stable
  --gateway-url <url>            real Gateway URL; also reads OPENCLAW_GATEWAY_URL or AGENTOS_OPENCLAW_GATEWAY_URL
  --json-output <path>           write sanitized JSON report to a file
  --summary-output <path>        write release-note Markdown summary to a file
  --human-output <path>          write human-readable report to a file
  --json-only                    print only JSON
  --fail-on-incompatible         exit non-zero on incompatible status (default)
  --fail-on-degraded             exit non-zero on degraded or incompatible status
  --allow-degraded               allow degraded status with a warning
  --runtime-started-by <source>  ci, script, external, or unknown
  --wait-timeout-ms <ms>         real Gateway readiness timeout; default 60000
  --retry-interval-ms <ms>       real Gateway readiness retry interval; default 2000
  --no-shape-checks              skip live response shape probes

Deprecated target aliases are still accepted:
  local -> real-local
  test-gateway-stable -> simulated-stable
  test-gateway-beta -> simulated-beta-shape

Default target is real-local.
`);
}

function parsePositiveIntegerArg(value: string | undefined, flag: string) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer after ${flag}.`);
  }
  return parsed;
}

async function waitForRealGatewayReady(input: {
  target: OpenClawCompatibilityTarget;
  gatewayUrl: string | null;
  timeoutMs: number;
  retryIntervalMs: number;
  nativeTimeoutMs: number;
}) {
  const startedAt = Date.now();
  let lastSummary = "No Gateway readiness attempt completed.";

  while (Date.now() - startedAt <= input.timeoutMs) {
    const client = new NativeWsOpenClawGatewayClient({
      ...(input.gatewayUrl ? { url: input.gatewayUrl } : {}),
      timeoutMs: input.nativeTimeoutMs
    });

    try {
      await client.probeNativeHandshake({ timeoutMs: input.nativeTimeoutMs });
      client.close("compatibility readiness check finished");
      return;
    } catch (error) {
      client.close("compatibility readiness retry");
      lastSummary = redactErrorMessage(error, "OpenClaw Gateway readiness probe failed.");
      await sleep(input.retryIntervalMs);
    }
  }

  throw new Error([
    `OpenClaw Gateway readiness failed for ${input.target.name}.`,
    `Expected endpoint: ${input.target.gatewayUrl ?? "default Gateway URL"}.`,
    `Timeout: ${input.timeoutMs} ms.`,
    "Gateway process exit code: unknown.",
    `Safe log summary: ${lastSummary}`,
    "Recovery: start or repair the real OpenClaw Gateway, verify native Gateway auth, then rerun compatibility checks."
  ].join(" "));
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function startCompatibilityTestGateway(target: OpenClawCompatibilityTarget) {
  const stableMethods = [
    ...OPENCLAW_GATEWAY_BASELINE_REQUIRED_METHODS,
    ...OPENCLAW_GATEWAY_BASELINE_OPTIONAL_METHODS
  ];
  const methods = target.name === "simulated-beta-shape"
    ? OPENCLAW_KNOWN_GATEWAY_FIRST_METHODS
    : stableMethods;
  const version = target.name === "simulated-beta-shape"
    ? `${OPENCLAW_RECOMMENDED_VERSION}-beta`
    : OPENCLAW_SUPPORTED_BASELINE_VERSION;
  const channel = target.name === "simulated-beta-shape" ? "beta" : "stable";
  const label = target.label;
  const methodSet = new Set(methods);
  const events = ["chat", "agent", "session.message", "session.tool", "task", "task.updated", "task.completed"];
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });

  server.on("connection", (socket) => {
    socket.on("message", (data) => {
      const frame = JSON.parse(data.toString()) as GatewayFrame;
      const id = frame.id;
      const method = frame.method;

      if (!id || !method) {
        return;
      }

      if (method === "connect") {
        send(socket, id, {
          type: "hello-ok",
          protocol: 4,
          server: { version },
          features: { methods, events },
          auth: { role: "operator", scopes: ["operator.read", "operator.write"] }
        });
        return;
      }

      if (!methodSet.has(method)) {
        fail(socket, id, `INVALID_REQUEST: unknown method: ${method}`);
        return;
      }

      send(socket, id, buildTestGatewayPayload(method, frame.params ?? {}, version));
    });
  });

  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Unable to bind compatibility test gateway.");
  }

  return {
    label,
    version,
    channel,
    port: address.port,
    url: `ws://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    })
  };
}

function send(socket: WebSocket, id: string | number, payload: unknown) {
  socket.send(JSON.stringify({ type: "res", id, ok: true, payload }));
}

function fail(socket: WebSocket, id: string | number, message: string) {
  socket.send(JSON.stringify({ type: "res", id, ok: false, error: { message } }));
}

function buildTestGatewayPayload(method: string, params: Record<string, unknown>, version: string) {
  switch (method) {
    case "health":
      return { ok: true };
    case "status":
      return { runtimeVersion: version, version };
    case "update.status":
      return { currentVersion: version, latestVersion: version, updateAvailable: false };
    case "models.list":
      return { models: [] };
    case "models.authStatus":
      return { auth: { providers: [] } };
    case "agents.list":
      return { agents: [] };
    case "sessions.list":
      return { sessions: [] };
    case "sessions.preview":
    case "chat.history":
      return { messages: [], sessions: [] };
    case "tasks.list":
      return { tasks: [] };
    case "artifacts.list":
      return { artifacts: [] };
    case "tools.catalog":
    case "tools.effective":
      return { tools: [] };
    case "plugins.list":
      return { plugins: [] };
    case "plugins.uiDescriptors":
      return { plugins: [], descriptors: [] };
    case "exec.approval.list":
      return { approvals: [], pending: [] };
    case "device.pair.list":
    case "devices.list":
      return { pending: [], devices: [] };
    case "cron.status":
      return { enabled: false, jobs: 0 };
    case "cron.list":
      return { jobs: [] };
    case "channels.status":
    case "channels.list":
      return { channels: {}, channelOrder: [], channelAccounts: {} };
    case "config.get":
      return { config: {}, hash: "test-gateway" };
    case "config.schema":
    case "config.schema.lookup":
      return { schema: { type: "object" } };
    case "logs.tail":
      return { lines: [], cursor: 0, size: 0 };
    case "skills.status":
      return { skills: [] };
    case "browser.request":
      return params.path === "/profiles" ? { profiles: [] } : { ok: true };
    default:
      return { ok: true, method };
  }
}

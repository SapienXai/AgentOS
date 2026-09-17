import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import type { Command } from "commander";
import process from "node:process";

import {
  buildAgentOsDoctorArgs,
  buildAgentOsStartArgs,
  buildAgentOsStatusArgs,
  runAgentOsCommand,
  type AgentOsDoctorOptions,
  type AgentOsStartOptions,
  type AgentOsStatusOptions
} from "./launcher.js";

const DESCRIPTION = "Open and inspect the AgentOS control plane";

export default definePluginEntry({
  id: "agentos",
  name: "AgentOS",
  description: "Official AgentOS CLI bridge for OpenClaw",
  register(api) {
    api.registerCli(
      ({ program }) => {
        registerAgentOsCli(program);
      },
      {
        descriptors: [
          {
            name: "agentos",
            description: DESCRIPTION,
            hasSubcommands: true
          }
        ]
      }
    );
  }
});

export function registerAgentOsCli(program: Command): void {
  const root = program.command("agentos").description(DESCRIPTION);
  addStartOptions(root);
  root.action(async (options: AgentOsStartOptions) => {
    await runAndSetExitCode(buildAgentOsStartArgs(options, true));
  });

  const open = root.command("open").description("Start AgentOS and open the control plane");
  addStartOptions(open);
  open.action(async (options: AgentOsStartOptions) => {
    await runAndSetExitCode(buildAgentOsStartArgs(options, true));
  });

  const start = root.command("start").description("Start the AgentOS control plane");
  addStartOptions(start);
  start.action(async (options: AgentOsStartOptions) => {
    await runAndSetExitCode(buildAgentOsStartArgs(options));
  });

  const status = root.command("status").description("Show AgentOS and OpenClaw runtime status");
  addStatusOptions(status);
  status.action(async (options: AgentOsStatusOptions) => {
    await runAndSetExitCode(buildAgentOsStatusArgs(options));
  });

  const doctor = root.command("doctor").description("Run AgentOS and OpenClaw diagnostics");
  addDoctorOptions(doctor);
  doctor.action(async (options: AgentOsDoctorOptions) => {
    await runAndSetExitCode(buildAgentOsDoctorArgs(options));
  });

  root.command("version").description("Print the installed AgentOS version").action(async () => {
    await runAndSetExitCode(["version"]);
  });
}

function addStartOptions(command: Command): void {
  command
    .option("-p, --port <port>", "AgentOS port")
    .option("-H, --host <host>", "AgentOS host")
    .option("-o, --open", "Open AgentOS in the default browser")
    .option("--plain", "Disable the AgentOS boot UI");
}

function addStatusOptions(command: Command): void {
  command.option("-p, --port <port>", "AgentOS port").option("-H, --host <host>", "AgentOS host");
}

function addDoctorOptions(command: Command): void {
  command
    .option("--deep", "Run read-only OpenClaw compatibility probes")
    .option("--json", "Print diagnostics as JSON")
    .option("-p, --port <port>", "AgentOS port")
    .option("-H, --host <host>", "AgentOS host");
}

async function runAndSetExitCode(args: readonly string[]): Promise<void> {
  const exitCode = await runAgentOsCommand(args);
  if (exitCode !== 0) process.exitCode = exitCode;
}

import "server-only";

import { getOpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import { runOpenClaw } from "@/lib/openclaw/cli";

export type GatewayControlAction = "start" | "stop" | "restart" | "doctor";

const inFlightGatewayControls = new Map<GatewayControlAction, Promise<unknown>>();
let openDashboardTask: Promise<void> | null = null;

export function controlGateway(action: GatewayControlAction) {
  const existing = inFlightGatewayControls.get(action);
  if (existing) {
    return existing;
  }

  const task = runGatewayControl(action).finally(() => {
    if (inFlightGatewayControls.get(action) === task) {
      inFlightGatewayControls.delete(action);
    }
  });

  inFlightGatewayControls.set(action, task);
  return task;
}

export function openOpenClawDashboard() {
  if (openDashboardTask) {
    return openDashboardTask;
  }

  const task = runOpenClaw(["dashboard"], { timeoutMs: 30_000 }).then(() => undefined);
  const trackedTask = task.finally(() => {
    if (openDashboardTask === trackedTask) {
      openDashboardTask = null;
    }
  });
  openDashboardTask = trackedTask;

  return openDashboardTask;
}

function runGatewayControl(action: GatewayControlAction) {
  if (action === "doctor") {
    return runOpenClaw(["doctor", "--fix"], { timeoutMs: 4 * 60_000 });
  }

  return getOpenClawAdapter().controlGateway(action);
}

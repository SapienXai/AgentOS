import "server-only";

import { runOpenClaw } from "@/lib/openclaw/cli";
import { getOpenClawLifecycleService } from "@/lib/openclaw/lifecycle/service";

export type GatewayControlAction = "start" | "stop" | "restart" | "doctor";
export type GatewayRecoveryAction = "start" | "restart";

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

/**
 * Explicit process recovery for the narrow case where native Gateway auth is
 * unavailable. This path proves only service liveness; privileged Gateway
 * requests remain fail-closed until a fresh native identity is available.
 */
export function controlGatewayForRecovery(action: GatewayRecoveryAction) {
  const lifecycle = getOpenClawLifecycleService();
  return action === "restart"
    ? lifecycle.restartForRecovery()
    : lifecycle.startForRecovery();
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

  return getOpenClawLifecycleService()[action]();
}

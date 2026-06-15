import "server-only";

import { getOpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import { runOpenClaw } from "@/lib/openclaw/cli";

export type GatewayControlAction = "start" | "stop" | "restart" | "doctor";

const inFlightGatewayControls = new Map<GatewayControlAction, Promise<unknown>>();

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

function runGatewayControl(action: GatewayControlAction) {
  if (action === "doctor") {
    return runOpenClaw(["doctor", "--fix"], { timeoutMs: 4 * 60_000 });
  }

  return getOpenClawAdapter().controlGateway(action);
}

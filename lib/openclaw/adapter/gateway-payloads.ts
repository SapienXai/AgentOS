import "server-only";

import { getOpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import type {
  GatewayStatusPayload,
  ModelsStatusPayload,
  OpenClawDeviceListPayload,
  OpenClawTaskListPayload,
  OpenClawUpdateStatusPayload,
  StatusPayload
} from "@/lib/openclaw/client/gateway-client";
import type { OpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";

export type UpdateStatusPayload = OpenClawUpdateStatusPayload;

export async function settleStatusPayloadFromOpenClaw(
  timeoutMs = 20_000,
  adapter: OpenClawAdapter = getOpenClawAdapter()
): Promise<PromiseSettledResult<StatusPayload>> {
  try {
    const value = await adapter.getStatus({ timeoutMs });

    return {
      status: "fulfilled",
      value
    };
  } catch (error) {
    return {
      status: "rejected",
      reason: error
    };
  }
}

export async function settleUpdateStatusPayloadFromOpenClaw(
  timeoutMs = 20_000,
  adapter: OpenClawAdapter = getOpenClawAdapter()
): Promise<PromiseSettledResult<UpdateStatusPayload>> {
  try {
    const value = await adapter.getUpdateStatus({ timeoutMs });

    return {
      status: "fulfilled",
      value
    };
  } catch (error) {
    return {
      status: "rejected",
      reason: error
    };
  }
}

export async function settleGatewayStatusPayloadFromOpenClaw(
  timeoutMs = 20_000,
  adapter: OpenClawAdapter = getOpenClawAdapter()
): Promise<PromiseSettledResult<GatewayStatusPayload>> {
  try {
    const value = await adapter.getGatewayStatus({ timeoutMs });

    return {
      status: "fulfilled",
      value
    };
  } catch (error) {
    return {
      status: "rejected",
      reason: error
    };
  }
}

export async function settleDeviceAccessPayloadFromOpenClaw(
  timeoutMs = 5_000,
  adapter: OpenClawAdapter = getOpenClawAdapter()
): Promise<PromiseSettledResult<OpenClawDeviceListPayload>> {
  try {
    if (!adapter.listDeviceAccess) {
      throw new Error("OpenClaw device access listing is unavailable in the current adapter.");
    }

    const value = await adapter.listDeviceAccess({ timeoutMs });

    return {
      status: "fulfilled",
      value
    };
  } catch (error) {
    return {
      status: "rejected",
      reason: error
    };
  }
}

export async function settleTaskListPayloadFromOpenClaw(
  timeoutMs = 10_000,
  adapter: OpenClawAdapter = getOpenClawAdapter()
): Promise<PromiseSettledResult<OpenClawTaskListPayload>> {
  try {
    const value = await adapter.listTasks({ limit: 500 }, { timeoutMs });

    return {
      status: "fulfilled",
      value
    };
  } catch (error) {
    return {
      status: "rejected",
      reason: error
    };
  }
}

export async function settleModelStatusPayloadFromOpenClaw(
  timeoutMs = 20_000,
  adapter: OpenClawAdapter = getOpenClawAdapter()
): Promise<PromiseSettledResult<ModelsStatusPayload>> {
  try {
    const value = await adapter.getModelStatus({ timeoutMs });

    return {
      status: "fulfilled",
      value
    };
  } catch (error) {
    return {
      status: "rejected",
      reason: error
    };
  }
}

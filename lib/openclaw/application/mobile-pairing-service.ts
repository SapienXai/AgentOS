import "server-only";

import { toDataURL } from "qrcode";

import { getMissionControlSnapshot } from "@/lib/agentos/control-plane";
import { getOpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import { controlGateway } from "@/lib/openclaw/application/gateway-service";
import { resetOpenClawGatewayClient } from "@/lib/openclaw/client/gateway-client-factory";
import { getGatewayNativeAuthStatus } from "@/lib/openclaw/application/settings-service";
import { runOpenClawJson } from "@/lib/openclaw/cli";
import type { OpenClawCommandOptions } from "@/lib/openclaw/client/types";
import { getOpenClawGatewayClient } from "@/lib/openclaw/client/gateway-client-factory";
import {
  isVerifiedNativeAuthorizationProof,
  resolveRequiredScopes
} from "@/lib/openclaw/identity/authorization";
import { decodeOpenClawMobileSetupCode, type OpenClawMobileManualSetup } from "@/lib/openclaw/mobile-pairing-projection";
import { redactErrorMessage } from "@/lib/security/redaction";

export type OpenClawMobilePairingNetwork = "current" | "lan";

export type OpenClawMobilePairingResult = {
  qrDataUrl: string;
  setupCode: string;
  gatewayUrl: string;
  gatewayUrls: string[];
  auth: string | null;
  urlSource: string | null;
  manual: OpenClawMobileManualSetup | null;
  restarted: boolean;
};

type OpenClawSetupCodePayload = {
  setupCode?: unknown;
  qrDataUrl?: unknown;
  gatewayUrl?: unknown;
  gatewayUrls?: unknown;
  auth?: unknown;
  urlSource?: unknown;
};

const gatewayBindConfigKey = "gateway.bind";
const gatewayRestartReadyTimeoutMs = 30_000;
const gatewayRestartPollIntervalMs = 750;

export async function prepareOpenClawMobilePairing(input: {
  network: OpenClawMobilePairingNetwork;
}, options: OpenClawCommandOptions = {}): Promise<OpenClawMobilePairingResult> {
  const snapshot = await getMissionControlSnapshot({ force: true });

  if (!snapshot.diagnostics.loaded || !snapshot.diagnostics.rpcOk) {
    throw new Error("Start and authenticate the OpenClaw Gateway before preparing mobile pairing.");
  }

  const authStatus = await getGatewayNativeAuthStatus();
  if (!authStatus.native.ok || !hasVerifiedGatewayAuthentication(authStatus)) {
    throw new Error("AgentOS could not verify Gateway authentication. Save or repair the Gateway token/password before enabling network access.");
  }

  const needsLanBind = input.network === "lan" && isLoopbackBind(snapshot.diagnostics.bindMode);
  if (needsLanBind) {
    await getOpenClawAdapter().setConfig(gatewayBindConfigKey, "lan", { ...options, timeoutMs: 10_000 });
    await controlGateway("restart");
    resetOpenClawGatewayClient("Gateway restarted for mobile pairing");
  }

  try {
    const payload = await waitForMobilePairingSetupCode(options);
    const nativeQrDataUrl = readPngDataUrl(payload.qrDataUrl);
    const nativeGatewayUrl = readString(payload.gatewayUrl);
    const nativeSetupCode = readString(payload.setupCode);
    const hasCompleteNativePayload = Boolean(nativeQrDataUrl && nativeGatewayUrl && nativeSetupCode);
    const fallback = hasCompleteNativePayload ? null : await createCliQrFallback(options);
    const qrDataUrl = hasCompleteNativePayload ? nativeQrDataUrl : fallback?.qrDataUrl ?? null;
    const setupCode = hasCompleteNativePayload ? nativeSetupCode : fallback?.setupCode ?? null;
    const gatewayUrl = hasCompleteNativePayload ? nativeGatewayUrl : fallback?.gatewayUrl ?? null;

    if (!qrDataUrl || !setupCode || !gatewayUrl) {
      throw new Error("OpenClaw did not return a scannable mobile pairing code.");
    }

    return {
      qrDataUrl,
      setupCode,
      gatewayUrl,
      gatewayUrls: readStringArray(payload.gatewayUrls).length ? readStringArray(payload.gatewayUrls) : fallback?.gatewayUrls ?? [],
      auth: readString(payload.auth) ?? fallback?.auth ?? null,
      urlSource: readString(payload.urlSource) ?? fallback?.urlSource ?? null,
      manual: decodeOpenClawMobileSetupCode(setupCode),
      restarted: needsLanBind
    };
  } catch (error) {
    throw new Error(resolveMobilePairingError(error));
  }
}

async function waitForMobilePairingSetupCode(options: OpenClawCommandOptions) {
  const deadline = Date.now() + gatewayRestartReadyTimeoutMs;
  let lastError: unknown = null;

  do {
    try {
      return await getOpenClawAdapter().call<OpenClawSetupCodePayload>(
        "device.pair.setupCode",
        {},
        { ...options, timeoutMs: 15_000 }
      );
    } catch (error) {
      lastError = error;
      if (!isGatewayRestartingError(error) || Date.now() >= deadline) {
        throw error;
      }

      resetOpenClawGatewayClient("Waiting for Gateway restart before mobile pairing");
      await delay(gatewayRestartPollIntervalMs);
    }
  } while (Date.now() < deadline);

  throw lastError ?? new Error("OpenClaw Gateway did not become ready after restart.");
}

async function createCliQrFallback(options: OpenClawCommandOptions) {
  await assertVerifiedCliMutationFallback("device.pair.setupCode", {}, options);
  const payload = await runOpenClawJson<OpenClawSetupCodePayload>(["qr", "--json"], { ...options, timeoutMs: 15_000 });
  const setupCode = readString(payload.setupCode);
  const gatewayUrl = readString(payload.gatewayUrl);

  if (!setupCode || !gatewayUrl) {
    throw new Error("OpenClaw did not return a scannable mobile pairing code.");
  }

  return {
    setupCode,
    qrDataUrl: await toDataURL(setupCode, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 512
    }),
    gatewayUrl,
    gatewayUrls: readStringArray(payload.gatewayUrls),
    auth: readString(payload.auth),
    urlSource: readString(payload.urlSource)
  };
}

async function assertVerifiedCliMutationFallback(
  method: string,
  params: Record<string, unknown>,
  options: OpenClawCommandOptions
) {
  const identity = await getOpenClawGatewayClient().getOperatorIdentity?.();
  if (identity && isVerifiedNativeAuthorizationProof(options.authorizationProof, identity, method, params)) {
    return;
  }

  const requiredScopes = resolveRequiredScopes(method, params);
  throw new Error(
    `CLI fallback for OpenClaw mutation ${method} requires a current native Gateway authorization proof for ${requiredScopes.join(", ")}.`
  );
}

function hasVerifiedGatewayAuthentication(status: Awaited<ReturnType<typeof getGatewayNativeAuthStatus>>) {
  const hasToken = status.config.authToken === "present" || status.config.authToken === "redacted" || status.env.token;
  const hasPassword = status.config.authPassword === "present" || status.config.authPassword === "redacted" || status.env.password;

  return (status.mode === "token" && hasToken) || (status.mode === "password" && hasPassword);
}

function isLoopbackBind(bindMode: string | undefined) {
  return !bindMode || /^(local|loopback|localhost)$/i.test(bindMode);
}

function readPngDataUrl(value: unknown) {
  return typeof value === "string" && /^data:image\/png;base64,/i.test(value) ? value : null;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readStringArray(value: unknown) {
  return Array.isArray(value) ? value.flatMap((entry) => {
    const normalized = readString(entry);
    return normalized ? [normalized] : [];
  }) : [];
}

function resolveMobilePairingError(error: unknown) {
  const message = redactErrorMessage(error, "OpenClaw could not prepare mobile pairing.");

  if (/operator\.admin|scope/i.test(message)) {
    return "OpenClaw requires administrator device access to create a mobile pairing code. Repair Gateway device access, then retry.";
  }
  if (/unknown method|unsupported/i.test(message)) {
    return "This OpenClaw Gateway does not support secure mobile pairing yet. Update OpenClaw, then retry.";
  }
  if (/wss:|public|tailscale|reachable|loopback/i.test(message)) {
    return "OpenClaw could not find a secure route your mobile device can reach. Configure a LAN, Tailscale, or public WSS Gateway route, then retry.";
  }
  if (isGatewayRestartingMessage(message)) {
    return "OpenClaw restarted for mobile pairing but did not become ready in time. Wait a moment, check Gateway Diagnostics, then retry. AgentOS did not use a CLI fallback for this Gateway operation.";
  }

  return message;
}

function isGatewayRestartingError(error: unknown) {
  return isGatewayRestartingMessage(redactErrorMessage(error, ""));
}

function isGatewayRestartingMessage(message: string) {
  return /gateway starting|retry shortly|gateway.*(?:not ready|unreachable)|connection (?:is )?not ready|ECONNREFUSED|ECONNRESET|connection closed/i.test(message);
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

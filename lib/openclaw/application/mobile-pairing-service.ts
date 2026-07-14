import "server-only";

import { toDataURL } from "qrcode";

import { getMissionControlSnapshot } from "@/lib/agentos/control-plane";
import { getOpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import { controlGateway } from "@/lib/openclaw/application/gateway-service";
import { getGatewayNativeAuthStatus } from "@/lib/openclaw/application/settings-service";
import { runOpenClawJson } from "@/lib/openclaw/cli";
import { redactErrorMessage } from "@/lib/security/redaction";

export type OpenClawMobilePairingNetwork = "current" | "lan";

export type OpenClawMobilePairingResult = {
  qrDataUrl: string;
  gatewayUrl: string;
  gatewayUrls: string[];
  auth: string | null;
  urlSource: string | null;
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

export async function prepareOpenClawMobilePairing(input: {
  network: OpenClawMobilePairingNetwork;
}): Promise<OpenClawMobilePairingResult> {
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
    await getOpenClawAdapter().setConfig(gatewayBindConfigKey, "lan", { timeoutMs: 10_000 });
    await controlGateway("restart");
  }

  try {
    const payload = await getOpenClawAdapter().call<OpenClawSetupCodePayload>(
      "device.pair.setupCode",
      {},
      { timeoutMs: 15_000 }
    );
    const nativeQrDataUrl = readPngDataUrl(payload.qrDataUrl);
    const nativeGatewayUrl = readString(payload.gatewayUrl);
    const fallback = nativeQrDataUrl && nativeGatewayUrl ? null : await createCliQrFallback();
    const qrDataUrl = nativeQrDataUrl ?? fallback?.qrDataUrl ?? null;
    const gatewayUrl = nativeGatewayUrl ?? fallback?.gatewayUrl ?? null;

    if (!qrDataUrl || !gatewayUrl) {
      throw new Error("OpenClaw did not return a scannable mobile pairing code.");
    }

    return {
      qrDataUrl,
      gatewayUrl,
      gatewayUrls: readStringArray(payload.gatewayUrls).length ? readStringArray(payload.gatewayUrls) : fallback?.gatewayUrls ?? [],
      auth: readString(payload.auth) ?? fallback?.auth ?? null,
      urlSource: readString(payload.urlSource) ?? fallback?.urlSource ?? null,
      restarted: needsLanBind
    };
  } catch (error) {
    throw new Error(resolveMobilePairingError(error));
  }
}

async function createCliQrFallback() {
  const payload = await runOpenClawJson<OpenClawSetupCodePayload>(["qr", "--json"], { timeoutMs: 15_000 });
  const setupCode = readString(payload.setupCode);
  const gatewayUrl = readString(payload.gatewayUrl);

  if (!setupCode || !gatewayUrl) {
    throw new Error("OpenClaw did not return a scannable mobile pairing code.");
  }

  return {
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

  return message;
}

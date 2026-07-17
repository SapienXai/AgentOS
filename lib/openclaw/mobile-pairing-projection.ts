export type OpenClawMobileManualSetup = {
  host: string;
  port: number;
  secure: boolean;
  pairingToken: string;
  expiresAtMs: number | null;
};

type SetupCodePayload = {
  url?: unknown;
  bootstrapToken?: unknown;
  token?: unknown;
  expiresAtMs?: unknown;
};

export function decodeOpenClawMobileSetupCode(setupCode: string): OpenClawMobileManualSetup | null {
  if (!setupCode || setupCode.length > 16_384 || !/^[A-Za-z0-9_-]+$/.test(setupCode)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(setupCode, "base64url").toString("utf8")) as SetupCodePayload;
    const urlValue = readString(payload.url);
    const pairingToken = readString(payload.bootstrapToken) ?? readString(payload.token);
    if (!urlValue || !pairingToken) {
      return null;
    }

    const url = new URL(urlValue);
    if (
      (url.protocol !== "ws:" && url.protocol !== "wss:")
      || url.username
      || url.password
      || url.search
      || url.hash
      || (url.pathname && url.pathname !== "/")
    ) {
      return null;
    }

    const port = url.port ? Number(url.port) : url.protocol === "wss:" ? 443 : 80;
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      return null;
    }

    return {
      host: url.hostname,
      port,
      secure: url.protocol === "wss:",
      pairingToken,
      expiresAtMs: readFiniteNumber(payload.expiresAtMs)
    };
  } catch {
    return null;
  }
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readFiniteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

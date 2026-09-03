import "server-only";

import { createPrivateKey, createPublicKey, sign } from "node:crypto";

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

/**
 * Neutral OpenClaw device-auth primitives shared by the official host adapter
 * and the rollback transport. Connection/auth assembly remains outside this
 * module so the official package remains the protocol owner.
 */
export function base64UrlEncode(buffer: Buffer) {
  return buffer.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

export function publicKeyRawBase64UrlFromPem(publicKeyPem: string) {
  const spki = createPublicKeyDer(publicKeyPem);

  if (
    spki.length === ED25519_SPKI_PREFIX.length + 32 &&
    spki.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)
  ) {
    return base64UrlEncode(spki.subarray(ED25519_SPKI_PREFIX.length));
  }

  return base64UrlEncode(spki);
}

export function createPublicKeyDer(publicKeyPem: string) {
  return Buffer.from(createPublicKey(publicKeyPem).export({
    type: "spki",
    format: "der"
  }) as Buffer);
}

export function signDevicePayload(privateKeyPem: string, payload: string) {
  const key = createPrivateKey(privateKeyPem);
  return base64UrlEncode(sign(null, Buffer.from(payload, "utf8"), key));
}

export function buildDeviceAuthPayloadV3(params: {
  deviceId: string;
  clientId: string;
  clientMode: string;
  role: string;
  scopes: string[];
  signedAtMs: number;
  token: string | null;
  nonce: string;
  platform: string;
  deviceFamily: string | null;
}) {
  return [
    "v3",
    params.deviceId,
    params.clientId,
    params.clientMode,
    params.role,
    params.scopes.join(","),
    String(params.signedAtMs),
    params.token ?? "",
    params.nonce,
    normalizeDeviceMetadataForAuth(params.platform),
    normalizeDeviceMetadataForAuth(params.deviceFamily)
  ].join("|");
}

/**
 * Temporary v3 signing compatibility helper copied from OpenClaw 2026.8.2
 * packages/gateway-client/src/device-auth.ts. Keep this neutral while the
 * official package owns the live connect/auth assembly.
 */
export function normalizeDeviceMetadataForAuth(value?: string | null) {
  if (typeof value !== "string") {
    return "";
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  return trimmed.replace(/[A-Z]/g, (character) => String.fromCharCode(character.charCodeAt(0) + 32));
}

import {
  OPENCLAW_IDENTITY_CONTRACT_BUILD,
  OPENCLAW_IDENTITY_CONTRACT_SOURCE_COMMIT,
  OPENCLAW_IDENTITY_CONTRACT_VERSION
} from "@/lib/openclaw/identity/contract";
import { OPENCLAW_RECOMMENDED_VERSION } from "@/lib/openclaw/versions";

/**
 * Allows disposable certification runs to exercise a candidate upstream
 * release before the recommended/native version constants are promoted.
 * This module is intentionally imported by certification scripts only.
 */
export const OPENCLAW_CERTIFICATION_TARGET_VERSION =
  process.env.OPENCLAW_CERTIFICATION_TARGET_VERSION?.trim() ||
  OPENCLAW_RECOMMENDED_VERSION;
export const OPENCLAW_CERTIFICATION_TARGET_COMMIT =
  process.env.OPENCLAW_CERTIFICATION_TARGET_COMMIT?.trim() ||
  OPENCLAW_IDENTITY_CONTRACT_SOURCE_COMMIT;
export const OPENCLAW_CERTIFICATION_TARGET_BUILD =
  process.env.OPENCLAW_CERTIFICATION_TARGET_BUILD?.trim() ||
  OPENCLAW_IDENTITY_CONTRACT_BUILD;
export const OPENCLAW_CERTIFICATION_TARGET_STATE_SCHEMA = Number(
  process.env.OPENCLAW_CERTIFICATION_TARGET_STATE_SCHEMA?.trim() ||
    (OPENCLAW_CERTIFICATION_TARGET_VERSION === "2026.9.4" ? "17" : "16")
);
export const OPENCLAW_CERTIFICATION_TARGET_AGENT_SCHEMA = Number(
  process.env.OPENCLAW_CERTIFICATION_TARGET_AGENT_SCHEMA?.trim() || "19"
);

export const OPENCLAW_CERTIFICATION_IDENTITY_VERSION = OPENCLAW_IDENTITY_CONTRACT_VERSION;

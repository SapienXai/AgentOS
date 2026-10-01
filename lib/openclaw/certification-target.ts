import {
  OPENCLAW_IDENTITY_CONTRACT_BUILD,
  OPENCLAW_IDENTITY_CONTRACT_SOURCE_COMMIT,
  OPENCLAW_IDENTITY_CONTRACT_VERSION,
  OPENCLAW_IDENTITY_CONTRACT_AGENT_SCHEMA,
  OPENCLAW_IDENTITY_CONTRACT_STATE_SCHEMA
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
  (OPENCLAW_CERTIFICATION_TARGET_VERSION === OPENCLAW_IDENTITY_CONTRACT_VERSION
    ? OPENCLAW_IDENTITY_CONTRACT_SOURCE_COMMIT
    : "");
export const OPENCLAW_CERTIFICATION_TARGET_BUILD =
  process.env.OPENCLAW_CERTIFICATION_TARGET_BUILD?.trim() ||
  (OPENCLAW_CERTIFICATION_TARGET_VERSION === OPENCLAW_IDENTITY_CONTRACT_VERSION
    ? OPENCLAW_IDENTITY_CONTRACT_BUILD
    : "");
const targetSchemas = resolveOpenClawCertificationTargetSchemas({
  targetVersion: OPENCLAW_CERTIFICATION_TARGET_VERSION,
  identityVersion: OPENCLAW_IDENTITY_CONTRACT_VERSION,
  identityStateSchema: OPENCLAW_IDENTITY_CONTRACT_STATE_SCHEMA,
  identityAgentSchema: OPENCLAW_IDENTITY_CONTRACT_AGENT_SCHEMA,
  candidateStateSchema: process.env.OPENCLAW_CERTIFICATION_TARGET_STATE_SCHEMA,
  candidateAgentSchema: process.env.OPENCLAW_CERTIFICATION_TARGET_AGENT_SCHEMA
});
export const OPENCLAW_CERTIFICATION_TARGET_STATE_SCHEMA = targetSchemas.stateSchema;
export const OPENCLAW_CERTIFICATION_TARGET_AGENT_SCHEMA = targetSchemas.agentSchema;

export const OPENCLAW_CERTIFICATION_IDENTITY_VERSION = OPENCLAW_IDENTITY_CONTRACT_VERSION;

export function resolveOpenClawCertificationTargetSchemas(input: {
  targetVersion: string;
  identityVersion: string;
  identityStateSchema: number;
  identityAgentSchema: number;
  candidateStateSchema?: string;
  candidateAgentSchema?: string;
}) {
  const candidateState = input.candidateStateSchema?.trim();
  const candidateAgent = input.candidateAgentSchema?.trim();
  const stateSchema = candidateState
    ? Number(candidateState)
    : input.targetVersion === input.identityVersion
      ? input.identityStateSchema
      : Number.NaN;
  const agentSchema = candidateAgent
    ? Number(candidateAgent)
    : input.targetVersion === input.identityVersion
      ? input.identityAgentSchema
      : Number.NaN;
  return {
    stateSchema: Number.isSafeInteger(stateSchema) && stateSchema > 0 ? stateSchema : Number.NaN,
    agentSchema: Number.isSafeInteger(agentSchema) && agentSchema > 0 ? agentSchema : Number.NaN
  };
}

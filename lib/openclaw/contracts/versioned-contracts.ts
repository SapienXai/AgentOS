import { AGENTOS_OPENCLAW_CONTRACT } from "@/lib/openclaw/contracts/agentos-openclaw-contract";
import type { AgentOsOpenClawContract } from "@/lib/openclaw/contracts/types";

export function getAgentOsOpenClawContractForBaseline(
  baselineVersion?: string | null
): AgentOsOpenClawContract {
  const normalizedBaseline = baselineVersion?.trim().replace(/^v/i, "");

  if (!normalizedBaseline || normalizedBaseline === AGENTOS_OPENCLAW_CONTRACT.certifiedOpenClawBaseline) {
    return AGENTOS_OPENCLAW_CONTRACT;
  }

  return AGENTOS_OPENCLAW_CONTRACT;
}

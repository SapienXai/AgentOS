import "server-only";

import { getOpenClawCompatibilityLabAreaDefinition } from "@/lib/openclaw/compatibility-lab/area-map";
import {
  persistOpenClawCodexFixBundle,
  readOpenClawCodexFixBundle,
  readOpenClawCompatibilityLabReport
} from "@/lib/openclaw/compatibility-lab/store";
import type {
  OpenClawCodexFixBundle,
  OpenClawCompatibilityLabReport
} from "@/lib/openclaw/compatibility-lab/types";
import { redactSecrets } from "@/lib/security/redaction";

const codexFixInstruction =
  "Preserve current AgentOS UX and only restore OpenClaw compatibility. Do not replace OpenClaw behavior with mocks." as const;

export async function generateOpenClawCodexFixBundle(input: {
  reportId: string;
}) {
  const existing = await readOpenClawCodexFixBundle(input.reportId);
  if (existing) {
    return existing;
  }

  const report = await readOpenClawCompatibilityLabReport(input.reportId);
  if (!report) {
    throw new Error("OpenClaw compatibility lab report was not found.");
  }

  const bundle = redactSecrets(buildOpenClawCodexFixBundle(report));
  await persistOpenClawCodexFixBundle(bundle);
  return bundle;
}

export function buildOpenClawCodexFixBundle(report: OpenClawCompatibilityLabReport): OpenClawCodexFixBundle {
  return {
    schemaVersion: 1,
    reportId: report.id,
    targetOpenClawVersion: report.targetOpenClawVersion,
    currentCertifiedBaseline: report.currentCertifiedBaseline,
    createdAt: new Date().toISOString(),
    instruction: codexFixInstruction,
    failures: report.areas
      .filter((area) => area.status !== "passed")
      .map((area) => {
        const definition = getOpenClawCompatibilityLabAreaDefinition(area.id);
        return {
          areaId: area.id,
          failingCommandOrTest: definition.failingCommandOrTest,
          redactedStdout: area.redactedCommandOutput?.stdout ?? null,
          redactedStderr: area.redactedCommandOutput?.stderr ?? null,
          expectedVsActualPayloadDiff: {
            expected: area.expectedBehaviorOrShape,
            actual: area.actualBehaviorOrShape,
            evidence: area.evidence
          },
          affectedFiles: area.affectedAgentOsFiles,
          suggestedMinimalPatchScope: area.suggestedFixScope,
          regressionTestsToAddOrUpdate: definition.regressionTestsToAddOrUpdate
        };
      })
  };
}

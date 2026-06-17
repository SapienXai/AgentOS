import { NextResponse } from "next/server";
import { z } from "zod";

import { generateOpenClawCodexFixBundle } from "@/lib/openclaw/compatibility-lab/fix-bundle-service";
import { promoteOpenClawCompatibilityCertification } from "@/lib/openclaw/compatibility-lab/certification-promotion-service";
import {
  generateOpenClawCompatibilityLabReport,
  getLatestOpenClawCompatibilityLabReport
} from "@/lib/openclaw/compatibility-lab/report-service";
import { redactErrorMessage, redactSecrets } from "@/lib/security/redaction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const compatibilityLabSchema = z.object({
  action: z.enum(["latest", "report", "fix-bundle", "certify"]).default("report"),
  targetVersion: z.string().trim().optional(),
  mode: z.enum(["recommended", "candidate", "advanced"]).default("recommended"),
  reportId: z.string().trim().optional()
});

export async function GET() {
  try {
    const report = await getLatestOpenClawCompatibilityLabReport();

    return NextResponse.json(redactSecrets({ report }));
  } catch (error) {
    return NextResponse.json(
      {
        error: redactErrorMessage(error, "Unable to read the OpenClaw Compatibility Lab report.")
      },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  let input: z.infer<typeof compatibilityLabSchema>;

  try {
    input = compatibilityLabSchema.parse(await request.json());
  } catch (error) {
    return NextResponse.json(
      {
        error: redactErrorMessage(error, "Invalid OpenClaw Compatibility Lab request.")
      },
      { status: 400 }
    );
  }

  try {
    if (input.action === "latest") {
      const report = await getLatestOpenClawCompatibilityLabReport();
      return NextResponse.json(redactSecrets({ report }));
    }

    if (input.action === "fix-bundle") {
      if (!input.reportId) {
        return NextResponse.json(
          { error: "A reportId is required to generate a Codex fix bundle." },
          { status: 400 }
        );
      }

      const bundle = await generateOpenClawCodexFixBundle({
        reportId: input.reportId
      });

      return NextResponse.json(redactSecrets({ bundle }));
    }

    if (input.action === "certify") {
      if (!input.reportId) {
        return NextResponse.json(
          { error: "A reportId is required to certify an OpenClaw target." },
          { status: 400 }
        );
      }

      const result = await promoteOpenClawCompatibilityCertification({
        reportId: input.reportId
      });

      return NextResponse.json(redactSecrets(result));
    }

    const report = await generateOpenClawCompatibilityLabReport({
      targetVersion: input.targetVersion,
      mode: input.mode
    });

    return NextResponse.json(redactSecrets({ report }));
  } catch (error) {
    return NextResponse.json(
      {
        error: redactErrorMessage(error, "OpenClaw Compatibility Lab request failed.")
      },
      { status: 500 }
    );
  }
}

import { NextResponse } from "next/server";
import path from "node:path";
import { z } from "zod";

import {
  beginOpenClawMigration,
  dryRunOpenClawMigration,
  getOpenClawMigrationFinalReport,
  getOpenClawMigrationProgress,
  inspectOpenClawMigration,
  planOpenClawMigration,
  resumeOpenClawMigration,
  rollbackOpenClawMigration
} from "@/lib/openclaw/application/openclaw-migration-service";
import { redactErrorMessage, redactSecrets } from "@/lib/security/redaction";
import { evaluateAgentOsApiRequest } from "@/lib/security/api-auth";
import { requireAgentOsActorContext } from "@/lib/security/agentos-actor";
import { recordAgentOsAuditEvent } from "@/lib/security/agentos-audit";
import { requireAgentOsProductPermission } from "@/lib/security/agentos-product-authorization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const pathField = z.string().trim().min(1).refine((value) => path.isAbsolute(value) && value !== path.parse(value).root, "An explicit non-root absolute path is required.");
const migrationInputSchema = z.object({
  action: z.enum(["inspect", "plan", "dry-run", "begin", "progress", "resume", "rollback", "report"]),
  journalPath: pathField.optional(),
  sourceBinaryPath: pathField.optional(),
  sourcePackageRoot: pathField.optional(),
  targetBinaryPath: pathField.optional(),
  targetPackageRoot: pathField.optional(),
  sourceStateDir: pathField.optional(),
  sourceConfigPath: pathField.optional(),
  targetStateDir: pathField.optional(),
  targetConfigPath: pathField.optional(),
  runtimePackageRoot: pathField.optional(),
  installPackageRoot: pathField.nullable().optional(),
  workRoot: pathField.optional(),
  snapshotRoot: pathField.optional(),
  supervisorMode: z.enum(["agentos-managed", "external", "unknown"]).optional(),
  gatewayPort: z.number().int().min(1024).max(65535).optional(),
  gatewayToken: z.string().min(1).optional()
});

export async function GET(request: Request) {
  const authFailure = evaluateAgentOsApiRequest({ method: "GET", url: request.url, headers: request.headers });
  if (!authFailure.ok) return NextResponse.json({ error: authFailure.message, code: authFailure.code }, { status: authFailure.status });
  const permission = await requireAgentOsProductPermission(request, "migrations.manage");
  if ("response" in permission) return permission.response;
  const journalPath = new URL(request.url).searchParams.get("journalPath");
  if (!journalPath) return NextResponse.json({ error: "journalPath is required." }, { status: 400 });
  try {
    return NextResponse.json({ run: redactSecrets(await getOpenClawMigrationProgress(journalPath)) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: redactErrorMessage(error, "Unable to read OpenClaw migration progress.") }, { status: 400 });
  }
}

export async function POST(request: Request) {
  const authFailure = evaluateAgentOsApiRequest({ method: "POST", url: request.url, headers: request.headers });
  if (!authFailure.ok) return NextResponse.json({ error: authFailure.message, code: authFailure.code }, { status: authFailure.status });
  const actorResult = await requireAgentOsActorContext(request);
  if ("response" in actorResult) return actorResult.response;
  const permission = await requireAgentOsProductPermission(request, "migrations.manage");
  if ("response" in permission) return permission.response;
  let input: z.infer<typeof migrationInputSchema>;
  try {
    input = migrationInputSchema.parse(await request.json());
  } catch (error) {
    return NextResponse.json({ error: redactErrorMessage(error, "Invalid OpenClaw migration request.") }, { status: 400 });
  }
  if (hasPathOverrides(input) && process.env.NODE_ENV === "production" && process.env.AGENTOS_OPENCLAW_MIGRATION_ALLOW_PATH_OVERRIDES !== "1") {
    return NextResponse.json({ error: "OpenClaw migration filesystem paths are server-controlled in production." }, { status: 403 });
  }

  try {
    if (["progress", "report"].includes(input.action)) {
      if (!input.journalPath) return NextResponse.json({ error: "journalPath is required." }, { status: 400 });
      const result = input.action === "report"
        ? await getOpenClawMigrationFinalReport(input.journalPath)
        : { run: await getOpenClawMigrationProgress(input.journalPath) };
      return NextResponse.json(redactSecrets(result), { headers: { "Cache-Control": "no-store" } });
    }

    const engineInput = requireEngineInput(input);
    const result = input.action === "inspect"
      ? await inspectOpenClawMigration(engineInput)
      : input.action === "plan"
        ? await planOpenClawMigration(engineInput)
        : input.action === "dry-run"
          ? await dryRunOpenClawMigration(engineInput)
          : input.action === "begin"
            ? await beginOpenClawMigration(engineInput)
            : input.action === "resume"
              ? await resumeOpenClawMigration(engineInput, requireJournalPath(input))
              : await rollbackOpenClawMigration(engineInput, requireJournalPath(input));
    await recordAgentOsAuditEvent({
      actor: actorResult.actor,
      operation: `openclaw.migration.${input.action}`,
      targetKind: "openclaw-migration",
      result: "succeeded"
    }).catch(() => {});
    return NextResponse.json(redactSecrets(result), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    await recordAgentOsAuditEvent({
      actor: actorResult.actor,
      operation: `openclaw.migration.${input.action}`,
      targetKind: "openclaw-migration",
      result: "failed"
    }).catch(() => {});
    return NextResponse.json({ error: redactErrorMessage(error, "OpenClaw migration request failed.") }, { status: 400 });
  }
}

function requireEngineInput(input: z.infer<typeof migrationInputSchema>) {
  const required = ["sourceBinaryPath", "targetBinaryPath", "sourceStateDir", "sourceConfigPath", "workRoot"] as const;
  for (const key of required) if (!input[key]) throw new Error(`${key} is required.`);
  return {
    sourceBinaryPath: input.sourceBinaryPath!,
    sourcePackageRoot: input.sourcePackageRoot,
    targetBinaryPath: input.targetBinaryPath!,
    targetPackageRoot: input.targetPackageRoot,
    sourceStateDir: input.sourceStateDir!,
    sourceConfigPath: input.sourceConfigPath!,
    targetStateDir: input.targetStateDir,
    targetConfigPath: input.targetConfigPath,
    runtimePackageRoot: input.runtimePackageRoot,
    installPackageRoot: input.installPackageRoot,
    workRoot: input.workRoot!,
    snapshotRoot: input.snapshotRoot,
    supervisorMode: input.supervisorMode,
    gatewayPort: input.gatewayPort,
    gatewayToken: input.gatewayToken
  };
}

function hasPathOverrides(input: z.infer<typeof migrationInputSchema>) {
  return ["sourceBinaryPath", "sourcePackageRoot", "targetBinaryPath", "targetPackageRoot", "sourceStateDir", "sourceConfigPath", "targetStateDir", "targetConfigPath", "runtimePackageRoot", "installPackageRoot", "workRoot", "snapshotRoot"].some((key) => input[key as keyof typeof input] !== undefined);
}

function requireJournalPath(input: z.infer<typeof migrationInputSchema>) {
  if (!input.journalPath) throw new Error("journalPath is required.");
  return input.journalPath;
}

import { NextResponse } from "next/server";

import { listChannelGroups } from "@/lib/openclaw/application/channel-directory-service";
import { readChannelAccounts } from "@/lib/openclaw/domains/channels";
import { createTimingCollector, formatTimingSummary, measureTiming } from "@/lib/openclaw/timing";
import { redactErrorMessage, redactSecrets } from "@/lib/security/redaction";
import { requireAgentOsProductPermission } from "@/lib/security/agentos-product-authorization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const timings = createTimingCollector("workspace-telegram-discovered-groups");

  try {
    await context.params;
    const permission = await requireAgentOsProductPermission(request, "runtime.use");
    if ("response" in permission) return permission.response;

    const searchParams = new URL(request.url).searchParams;
    const requestedAccountId = searchParams.get("accountId")?.trim() || null;
    const accountId = requestedAccountId ?? await resolveDefaultTelegramAccountId();
    const result = await measureTiming(timings, "telegram.discovery", () => listChannelGroups({
      provider: "telegram",
      accountId,
      query: searchParams.get("query"),
      limit: parsePositiveLimit(searchParams.get("limit"))
    }, { timings }));

    const groups = result.entries.map((entry) => ({
      chatId: entry.routeId,
      title: entry.title,
      lastSeen: null,
      kind: entry.kind,
      accountId: entry.accountId,
      accessPolicy: entry.accessPolicy
    }));
    const summary = timings.summary();
    console.info(formatTimingSummary(summary));

    return NextResponse.json(redactSecrets({
      accountId,
      groups,
      source: result.source,
      status: result.status,
      fallbackReason: result.fallbackReason,
      error: result.error,
      timings: summary
    }), {
      status: result.status === "failed" ? 503 : 200,
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    const summary = timings.summary();
    console.info(formatTimingSummary(summary));

    return NextResponse.json(
      {
        error: redactErrorMessage(error, "Unable to discover Telegram groups."),
        timings: summary
      },
      { status: 400 }
    );
  }
}

async function resolveDefaultTelegramAccountId() {
  const accounts = await readChannelAccounts();
  const telegramAccounts = accounts.filter((account) => account.type === "telegram");
  const accountId = (account: (typeof telegramAccounts)[number] | undefined) => account?.accountId?.trim() || account?.id || null;
  return accountId(telegramAccounts.find((account) => account.isDefault))
    ?? accountId(telegramAccounts.find((account) => account.accountId === "default"))
    ?? accountId(telegramAccounts[0])
    ?? null;
}

function parsePositiveLimit(value: string | null) {
  const parsed = value ? Number(value) : NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

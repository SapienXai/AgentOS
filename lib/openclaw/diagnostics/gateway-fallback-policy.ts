export type GatewayFallbackHealthImpact = "blocking" | "degrading" | "informational";

export type GatewayFallbackDiagnosticLike = {
  at?: string;
  operation: string;
  issue?: string | null;
  kind?: string | null;
};

/**
 * Only known read-only helper surfaces are informational. Any operation not
 * listed here keeps the safe default: using CLI means reduced native runtime
 * capability and therefore degrades health.
 */
const informationalFallbackOperations = new Set([
  "update.status",
  "diagnostics.stability",
  "diagnosticsStability",
  "models.scan",
  "modelScan",
  "plugins",
  "plugins.list",
  "plugins.uiDescriptors",
  "pluginCatalog",
  "plugins.catalog.browse",
  "plugins.catalog.categories",
  "plugins.catalog.get",
  "commands.list",
  "tools.catalog",
  "tools.effective",
  "usage.status",
  "usage.cost",
  "sessions.usage",
  "sessions.usage.timeseries",
  "sessions.usage.logs",
  "logs.tail",
  "logsTail",
  "system-presence",
  "last-heartbeat",
  "presence",
  "compatibility",
  "compatibility.report",
  "rpc.discover",
  "rpc.methods",
  "system.capabilities"
]);

export function classifyGatewayFallbackImpact(
  diagnostic: GatewayFallbackDiagnosticLike
): GatewayFallbackHealthImpact {
  const kind = diagnostic.kind?.trim().toLowerCase();
  const issue = diagnostic.issue?.trim() ?? "";

  if (
    kind === "auth" ||
    kind === "scope-limited" ||
    /\b(?:unauthorized|unauthorised|forbidden|permission denied|access denied)\b|scope upgrade pending|missing (?:required )?(?:operator )?scopes?|token (?:mismatch|expired|invalid)/i.test(issue)
  ) {
    return "blocking";
  }

  if (
    diagnostic.operation === "models.list" &&
    /incomplete .* catalog while provider-scoped discovery was requested/i.test(issue)
  ) {
    return "informational";
  }

  return informationalFallbackOperations.has(diagnostic.operation)
    ? "informational"
    : "degrading";
}

/**
 * A fallback only affects the current Gateway connection when it happened
 * after that connection was established. Invalid timestamps remain visible
 * and conservative because they cannot safely prove the record is stale.
 */
export function isGatewayFallbackDiagnosticCurrent(
  diagnostic: Pick<GatewayFallbackDiagnosticLike, "at">,
  lastConnectedAt: string | null | undefined
) {
  if (!lastConnectedAt || !diagnostic.at) {
    return true;
  }

  const diagnosticTime = Date.parse(diagnostic.at);
  const connectionTime = Date.parse(lastConnectedAt);

  if (!Number.isFinite(diagnosticTime) || !Number.isFinite(connectionTime)) {
    return true;
  }

  return diagnosticTime >= connectionTime;
}

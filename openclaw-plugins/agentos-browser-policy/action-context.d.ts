export type BrowserActionContextRef = {
  role?: string;
  name?: string;
  value?: string;
  description?: string;
};

export type TrustedBrowserActionContext = {
  source?: "openclaw.browser.request";
  targetId: string;
  url: string;
  refs: Record<string, BrowserActionContextRef>;
  pageSignals?: string[];
  dialogMessages?: string[];
  blockedByDialog?: boolean;
  truncated?: boolean;
  semanticSnapshotGeneration?: string;
};

export function readActRequest(params: unknown): Record<string, unknown>;
export function readActKind(params: unknown): string;
export function readActRefs(params: unknown): string[];
export function readTargetId(params: unknown): string | null;
export function readSubmit(params: unknown): boolean;
export function readKey(params: unknown): string;

export function buildTrustedBrowserActionContext(
  raw: unknown,
  options?: { expectedTargetId?: string; allowedDomains?: string[] }
): TrustedBrowserActionContext | null;

export function parseBrowserToolSnapshotResult(
  result: unknown,
  options?: { allowedDomains?: string[] }
): TrustedBrowserActionContext | null;

export function classifyBrowserAction(input: {
  action?: string;
  params?: Record<string, unknown>;
  binding?: { serviceId?: string };
  trustedContext?: TrustedBrowserActionContext | null;
  observedContext?: TrustedBrowserActionContext | null;
}): {
  capability: "read" | "interact" | "publish" | "transact" | "account_admin" | "unknown";
  reason: string;
  staleReference?: boolean;
};

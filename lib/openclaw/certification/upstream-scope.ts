export const PHASE_6_NATIVE_METHODS = [
  "health",
  "status",
  "diagnostics.stability",
  "config.get",
  "update.status",
  "update.hold",
  "update.run",
  "gateway.restart.preflight",
  "gateway.restart.request",
  "gateway.suspend.prepare",
  "gateway.suspend.status",
  "gateway.suspend.resume"
] as const;

export type Phase6NativeMethod = typeof PHASE_6_NATIVE_METHODS[number];

/**
 * Parse the pinned OpenClaw core descriptor table without treating an
 * AgentOS-owned scope map as upstream evidence. The descriptor rows are a
 * deliberately narrow, stable source contract; ambiguity fails closed.
 */
export function parsePinnedCoreDescriptorScopes(
  source: string,
  methods: readonly string[] = PHASE_6_NATIVE_METHODS
): Record<string, string> {
  const scopes: Record<string, string> = {};
  for (const method of methods) {
    const escapedMethod = method.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`\\[\\s*"${escapedMethod}"\\s*,\\s*(?:null|"[^"]*")\\s*,\\s*"([^"]+)"\\s*,`, "g");
    const matches = [...source.matchAll(pattern)];
    if (matches.length !== 1 || !matches[0]?.[1]) {
      throw new Error(`Pinned OpenClaw descriptor scope for ${method} is missing or ambiguous.`);
    }
    scopes[method] = matches[0][1];
  }
  return scopes;
}

export function comparePinnedMethodScopes(
  expected: Record<string, readonly string[]>,
  actual: Record<string, string>,
  methods: readonly string[] = PHASE_6_NATIVE_METHODS
) {
  return methods.every((method) => expected[method]?.length === 1 && expected[method][0] === actual[method]);
}

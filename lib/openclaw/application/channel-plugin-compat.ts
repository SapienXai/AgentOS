export function resolveExactOpenClawPluginSpec(packageName: string, runtimeVersion: string | null) {
  const normalizedPackageName = packageName.trim();
  const normalizedVersion = runtimeVersion?.trim() ?? "";

  if (!normalizedPackageName || !/^\d{4}\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(normalizedVersion)) {
    return null;
  }

  return `${normalizedPackageName}@${normalizedVersion}`;
}

export function isPluginApiVersionMismatch(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /requires plugin API\s*>?=/i.test(message) || /runtime exposes\s+\d{4}\.\d+\.\d+/i.test(message);
}

export function resolveChannelPluginActivation(input: {
  pluginId: string | null;
  pluginEnabled: boolean;
  installPackage: string | null;
  runtimeVersion: string | null;
}) {
  if (input.pluginEnabled) {
    return { action: "already-enabled" as const, spec: null };
  }

  if (input.pluginId) {
    return { action: "enable" as const, spec: input.pluginId };
  }

  const installSpec = input.installPackage
    ? resolveExactOpenClawPluginSpec(input.installPackage, input.runtimeVersion)
    : null;

  return installSpec
    ? { action: "install" as const, spec: installSpec }
    : { action: "unavailable" as const, spec: null };
}

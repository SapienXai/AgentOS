export function shouldAttemptOpenClawUpdateRecovery(output: string) {
  const normalized = output.trim();

  if (!normalized) {
    return false;
  }

  const updateFinished = /Update Result:\s*OK/i.test(normalized);
  const versionAdvanced = /\bBefore:\s*\d+(?:\.\d+)+/i.test(normalized) && /\bAfter:\s*\d+(?:\.\d+)+/i.test(normalized);
  const postUpdateFailure =
    /Completion cache update failed/i.test(normalized) ||
    /Gateway did not become healthy after restart/i.test(normalized) ||
    /Gateway version mismatch/i.test(normalized) ||
    /updated install (?:refresh|restart) failed/i.test(normalized) ||
    /Gateway (?:install|restart) blocked/i.test(normalized) ||
    /Run `?openclaw gateway status --deep`? for details/i.test(normalized);

  return (updateFinished || versionAdvanced) && postUpdateFailure;
}

export function isOpenClawDowngradeConfigBlocker(output: string) {
  const normalized = output.trim();

  if (!normalized) {
    return false;
  }

  return (
    /older than the config last written by OpenClaw/i.test(normalized) ||
    /Refusing to (?:install|rewrite|restart).*because this OpenClaw binary .* is older than the config last written/i.test(normalized) ||
    /OpenClaw config was written by version .*but this command is running/i.test(normalized) ||
    /Gateway service was installed by OpenClaw .*current CLI is/i.test(normalized)
  );
}

export function resolveOpenClawDowngradeBlockerRestoreVersion(output: string) {
  const normalized = output.trim();

  if (!normalized || !isOpenClawDowngradeConfigBlocker(normalized)) {
    return null;
  }

  return (
    normalized.match(/\bconfig last written by OpenClaw\s+v?(\d+(?:\.\d+)+)\b/i)?.[1] ??
    normalized.match(/\bconfig was written by version\s+v?(\d+(?:\.\d+)+)\b/i)?.[1] ??
    normalized.match(/\binstalled by OpenClaw\s+v?(\d+(?:\.\d+)+)\b/i)?.[1] ??
    null
  );
}

export function isOpenClawGatewayReadyOutput(output: string) {
  const normalized = output.trim();

  if (!normalized) {
    return false;
  }

  return (
    /Gateway Health\s+OK/i.test(normalized) ||
    /(?:^|\n)\s*OK\s*(?:\n|$)/i.test(normalized) ||
    /Connectivity probe:\s*ok/i.test(normalized) ||
    /Capability:\s*admin-capable/i.test(normalized)
  );
}

export function buildOpenClawUpdateRecoveryManualCommand(command: string) {
  return `${command} doctor --fix && ${command} gateway restart && ${command} gateway status --deep`;
}

export function buildOpenClawDowngradeConfigBlockerManualCommand(command: string, restoreVersion: string | null | undefined) {
  const version = restoreVersion?.trim().replace(/^v/i, "");

  if (!version) {
    return buildOpenClawUpdateRecoveryManualCommand(command);
  }

  return `${command} update --tag ${version} --yes && ${command} gateway restart && ${command} gateway status --deep`;
}

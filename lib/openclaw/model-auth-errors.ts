export function isOpenAiCodexAuthRefreshFailure(output: string) {
  const normalized = output.trim();

  return (
    /OAuth token refresh failed for openai/i.test(normalized) ||
    /OAuth token refresh failed for openai-codex/i.test(normalized) ||
    /OpenAI Codex token refresh failed\s*\(401\)/i.test(normalized) ||
    /refresh token has already been used to generate a new access token/i.test(normalized)
  );
}

export function isOpenAiCodexProviderPluginMissing(output: string) {
  const normalized = output.trim();

  return (
    /No provider plugins found/i.test(normalized) ||
    /plugin not installed:\s*codex/i.test(normalized) ||
    /plugins\.entries\.codex.*plugin not installed/i.test(normalized)
  );
}

export function isOpenAiCodexAuthRecoveryMessage(output: string) {
  const normalized = output.trim();

  return (
    /Your ChatGPT\/Codex session has expired/i.test(normalized) &&
    /models auth login --provider (?:openai|openai-codex|codex)/i.test(normalized)
  );
}

export function isOpenAiCodexAuthFailure(output: string) {
  return (
    isOpenAiCodexAuthRefreshFailure(output) ||
    isOpenAiCodexAuthRecoveryMessage(output) ||
    isOpenAiCodexProviderPluginMissing(output)
  );
}

export function isOpenAiCodexDiscoveryTimeout(output: string) {
  return /OpenClaw command timed out after \d+ seconds|Command exceeded \d+ seconds/i.test(output);
}

export function resolveOpenAiCodexAuthRecoveryMessage(command: string) {
  return [
    "Your ChatGPT/Codex session has expired. Reconnect ChatGPT, then retry model discovery or runtime verification.",
    `Run: ${command}`
  ].join(" ");
}

export function buildOpenAiCodexAuthLoginCommand(commandBin: string, options?: { force?: boolean }) {
  const forceFlag = options?.force ? " --force" : "";

  return `${quoteShellArg(commandBin)} models auth login --provider openai${forceFlag} --set-default`;
}

export function buildOpenAiCodexAuthRepairCommand(commandBin: string, options?: { force?: boolean }) {
  const command = quoteShellArg(commandBin);
  const forceFlag = options?.force ? " --force" : "";

  return `${command} plugins install --force @openclaw/codex && ${command} doctor --fix && ${command} gateway restart && ${command} models auth login --provider openai${forceFlag} --set-default`;
}

export function resolveOpenAiCodexAuthHandoff(
  commandBin: string,
  pluginReady: boolean,
  options?: {
    force?: boolean;
    intent?: "setup" | "refresh" | "switch-account";
  }
) {
  const actionLabel = resolveOpenAiCodexAuthActionLabel(options);

  if (pluginReady) {
    const command = buildOpenAiCodexAuthLoginCommand(commandBin, options);

    return {
      command,
      statusMessage: "Preparing Codex app-server setup in terminal...",
      continueMessage:
        `Continue in terminal to ${actionLabel}. After auth completes, return here and refresh setup.`,
      verificationMessage:
        `The model was saved. Continue in terminal to ${actionLabel} and finish setup.`
    };
  }

  const command = buildOpenAiCodexAuthRepairCommand(commandBin, options);

  return {
    command,
    statusMessage: "Preparing Codex plugin setup in terminal...",
    continueMessage:
      `Continue in terminal to install the Codex provider plugin, then ${actionLabel}.`,
    verificationMessage:
      `The model was saved. Install the Codex provider plugin, then ${actionLabel}.`
    };
}

function resolveOpenAiCodexAuthActionLabel(options?: {
  force?: boolean;
  intent?: "setup" | "refresh" | "switch-account";
}) {
  if (options?.intent === "switch-account") {
    return "switch the ChatGPT account for Codex app-server";
  }

  if (options?.intent === "refresh" || options?.force) {
    return "refresh the Codex app-server setup";
  }

  return "finish the Codex app-server setup";
}

export function resolveOpenAiCodexProviderPluginRecoveryMessage(command: string) {
  return [
    "OpenClaw needs the Codex provider plugin installed and enabled before auth login can continue.",
    "Install the plugin, refresh the registry, restart the gateway, then retry.",
    `Run: ${command}`
  ].join(" ");
}

function quoteShellArg(value: string) {
  if (/^[a-zA-Z0-9_./:@%+=,-]+$/.test(value)) {
    return value;
  }

  return `'${value.replaceAll("'", "'\\''")}'`;
}

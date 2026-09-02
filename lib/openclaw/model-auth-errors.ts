export function isOpenAiAuthRefreshFailure(output: string) {
  const normalized = output.trim();

  return (
    /OAuth token refresh failed for openai/i.test(normalized) ||
    /OpenAI (?:Codex )?token refresh failed\s*\(401\)/i.test(normalized) ||
    /refresh token has already been used to generate a new access token/i.test(normalized)
  );
}

export function isOpenAiProviderPluginMissing(output: string) {
  const normalized = output.trim();

  return (
    /No provider plugins found/i.test(normalized) ||
    /plugin not installed:\s*codex/i.test(normalized) ||
    /plugins\.entries\.codex.*plugin not installed/i.test(normalized)
  );
}

export function isOpenAiAuthRecoveryMessage(output: string) {
  const normalized = output.trim();

  return (
    /Your ChatGPT session has expired/i.test(normalized) &&
    /models auth login --provider openai/i.test(normalized)
  );
}

export function isOpenAiAuthFailure(output: string) {
  return (
    isOpenAiAuthRefreshFailure(output) ||
    isOpenAiAuthRecoveryMessage(output) ||
    isOpenAiProviderPluginMissing(output)
  );
}

export function isOpenAiDiscoveryTimeout(output: string) {
  return /OpenClaw command timed out after \d+ seconds|Command exceeded \d+ seconds/i.test(output);
}

export function resolveOpenAiAuthRecoveryMessage(command: string) {
  return [
    "Your ChatGPT session has expired. Reconnect ChatGPT, then retry model discovery or runtime verification.",
    `Run: ${command}`
  ].join(" ");
}

export function buildOpenAiAuthLoginCommand(commandBin: string, options?: { force?: boolean }) {
  const forceFlag = options?.force ? " --force" : "";

  return `${quoteShellArg(commandBin)} models auth login --provider openai${forceFlag} --set-default`;
}

export function buildOpenAiAuthRepairCommand(commandBin: string, options?: { force?: boolean }) {
  const command = quoteShellArg(commandBin);
  const forceFlag = options?.force ? " --force" : "";

  return `${command} plugins install --force @openclaw/codex && ${command} gateway restart && ${command} models auth login --provider openai${forceFlag} --set-default`;
}

export function resolveOpenAiAuthHandoff(
  commandBin: string,
  pluginReady: boolean,
  options?: {
    force?: boolean;
    intent?: "setup" | "refresh" | "switch-account";
  }
) {
  void commandBin;
  const actionLabel = resolveOpenAiAuthActionLabel(options);

  if (pluginReady) {
    return {
      command: null,
      statusMessage: "Opening ChatGPT authorization in your browser...",
      continueMessage:
        `Complete the OpenClaw ChatGPT authorization page in your browser. AgentOS will verify the ${actionLabel} automatically.`,
      verificationMessage:
        `OpenClaw finished the ChatGPT authorization flow. AgentOS will verify ${actionLabel} before continuing.`
    };
  }

  return {
    command: null,
    statusMessage: "Installing the OpenClaw Codex runtime and opening ChatGPT authorization...",
    continueMessage:
      `OpenClaw is installing @openclaw/codex and will open ChatGPT authorization in your browser for ${actionLabel}.`,
    verificationMessage:
      `OpenClaw installed @openclaw/codex. Complete ChatGPT authorization in your browser, then AgentOS will verify ${actionLabel}.`
    };
}

function resolveOpenAiAuthActionLabel(options?: {
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

export function resolveOpenAiProviderPluginRecoveryMessage(command: string) {
  return [
    "OpenClaw needs @openclaw/codex installed and enabled before ChatGPT authorization can continue.",
    "Install the plugin through OpenClaw, restart the Gateway, then retry ChatGPT authorization.",
    `Run: ${command}`
  ].join(" ");
}

function quoteShellArg(value: string) {
  if (/^[a-zA-Z0-9_./:@%+=,-]+$/.test(value)) {
    return value;
  }

  return `'${value.replaceAll("'", "'\\''")}'`;
}

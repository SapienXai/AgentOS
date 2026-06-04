import "server-only";

import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";

import { OPENCLAW_RECOMMENDED_VERSION } from "@/lib/openclaw/versions";

export const OPENCLAW_INSTALL_DOCS_URL = "https://docs.openclaw.ai/install";

const OPENCLAW_INSTALL_CLI_URL = "https://openclaw.ai/install-cli.sh";
const OPENCLAW_INSTALL_POWERSHELL_URL = "https://openclaw.ai/install.ps1";
const OPENCLAW_PATH_MARKER_START = "# >>> OpenClaw PATH >>>";
const OPENCLAW_PATH_MARKER_END = "# <<< OpenClaw PATH <<<";
const OPENCLAW_POSIX_ENV_FILE_NAME = "agentos-env.sh";

export type OpenClawPathSetupResult = {
  binDir: string;
  alreadyOnPath: boolean;
  updatedCurrentProcess: boolean;
  updatedFiles: string[];
  createdFiles: string[];
  updatedWindowsUserPath: boolean;
  warnings: string[];
};

type OpenClawPathSetupOptions = {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  platform?: NodeJS.Platform;
  shell?: string;
  windowsUserPath?: string;
  runPowerShellScript?: (script: string) => Promise<string>;
};

export function getOpenClawLocalPrefix() {
  return path.join(os.homedir(), ".openclaw");
}

export function getOpenClawLocalPrefixBinPath() {
  return path.join(getOpenClawLocalPrefix(), "bin", process.platform === "win32" ? "openclaw.cmd" : "openclaw");
}

export function getOpenClawBundledNodeBinPath() {
  return path.join(
    getOpenClawLocalPrefix(),
    "tools",
    "node",
    "bin",
    process.platform === "win32" ? "openclaw.cmd" : "openclaw"
  );
}

export function getOpenClawUserLocalBinPath() {
  return path.join(os.homedir(), ".local", "bin", process.platform === "win32" ? "openclaw.cmd" : "openclaw");
}

export function getOpenClawInstallCommand() {
  const installAndPinRecommendedVersionCommand = buildOpenClawInstallPinCommand();

  if (process.platform === "win32") {
    return `& ([scriptblock]::Create((iwr -useb ${OPENCLAW_INSTALL_POWERSHELL_URL}))) -Tag ${OPENCLAW_RECOMMENDED_VERSION} -NoOnboard; if ($LASTEXITCODE -eq 0) { ${installAndPinRecommendedVersionCommand} } else { exit $LASTEXITCODE }`;
  }

  return `set -euo pipefail; curl -fsSL --proto '=https' --tlsv1.2 ${OPENCLAW_INSTALL_CLI_URL} | bash -s -- --prefix "$HOME/.openclaw" --version ${OPENCLAW_RECOMMENDED_VERSION} --no-onboard && ${installAndPinRecommendedVersionCommand}`;
}

function buildOpenClawInstallPinCommand() {
  const commandPath = quoteShellArg(getOpenClawLocalPrefixBinPath());
  return `${commandPath} update --tag ${OPENCLAW_RECOMMENDED_VERSION} --yes`;
}

function quoteShellArg(value: string) {
  if (/^[a-zA-Z0-9_./:@%+=,-]+$/.test(value)) {
    return value;
  }

  return `'${value.replaceAll("'", "'\\''")}'`;
}

export async function ensureOpenClawLocalBinOnPath(
  options: OpenClawPathSetupOptions = {}
): Promise<OpenClawPathSetupResult> {
  const platform = options.platform ?? process.platform;
  const homeDir = options.homeDir ?? os.homedir();
  const env = options.env ?? process.env;
  const pathApi = pathForPlatform(platform);
  const binDir = pathApi.join(homeDir, ".openclaw", "bin");
  const alreadyOnPath = pathListIncludesDirectory(getEnvPathValue(env, platform), binDir, platform);
  const updatedCurrentProcess = prependDirectoryToEnvPath(env, binDir, platform);

  if (platform === "win32") {
    const windowsResult = await ensureOpenClawWindowsUserPath(binDir, {
      currentUserPath: options.windowsUserPath,
      runPowerShellScript: options.runPowerShellScript
    });

    return {
      binDir,
      alreadyOnPath,
      updatedCurrentProcess,
      updatedFiles: [],
      createdFiles: [],
      updatedWindowsUserPath: windowsResult.updated,
      warnings: windowsResult.warnings
    };
  }

  const posixResult = await ensureOpenClawPosixShellPath({
    binDir,
    homeDir,
    platform,
    shell: options.shell ?? env.SHELL ?? ""
  });

  return {
    binDir,
    alreadyOnPath,
    updatedCurrentProcess,
    updatedFiles: posixResult.updatedFiles,
    createdFiles: posixResult.createdFiles,
    updatedWindowsUserPath: false,
    warnings: posixResult.warnings
  };
}

export function buildOpenClawPathSetupSummary(result: OpenClawPathSetupResult) {
  const target = result.binDir;

  if (result.updatedWindowsUserPath) {
    return `Added ${target} to the Windows user PATH. Open a new terminal to use openclaw directly.`;
  }

  const shellFiles = Array.from(new Set([...result.updatedFiles, ...result.createdFiles]));

  if (shellFiles.length > 0) {
    return `Added ${target} to shell startup files. Open a new terminal to use openclaw directly.`;
  }

  if (result.alreadyOnPath && !result.updatedCurrentProcess) {
    return `${target} is already on PATH.`;
  }

  return `Prepared ${target} for the current AgentOS process. Open a new terminal after adding it to PATH if openclaw is not found.`;
}

export function pathListIncludesDirectory(
  pathValue: string | undefined,
  directory: string,
  platform: NodeJS.Platform = process.platform
) {
  const normalizedDirectory = normalizePathForComparison(directory, platform);

  return splitPathList(pathValue, platform).some(
    (entry) => normalizePathForComparison(entry, platform) === normalizedDirectory
  );
}

export function mergeDirectoryIntoPathList(
  pathValue: string | undefined,
  directory: string,
  platform: NodeJS.Platform = process.platform
) {
  if (pathListIncludesDirectory(pathValue, directory, platform)) {
    return pathValue ?? "";
  }

  const delimiter = platform === "win32" ? ";" : ":";
  return pathValue?.trim() ? `${directory}${delimiter}${pathValue}` : directory;
}

async function ensureOpenClawPosixShellPath(options: {
  binDir: string;
  homeDir: string;
  platform: NodeJS.Platform;
  shell: string;
}) {
  const prefix = path.join(options.homeDir, ".openclaw");
  const envFilePath = path.join(prefix, OPENCLAW_POSIX_ENV_FILE_NAME);
  const updatedFiles: string[] = [];
  const createdFiles: string[] = [];
  const warnings: string[] = [];
  const envFileContent = buildOpenClawPosixEnvFileContent();
  const envWriteStatus = await writeTextFileIfChanged(envFilePath, envFileContent);

  if (envWriteStatus === "created") {
    createdFiles.push(envFilePath);
  } else if (envWriteStatus === "updated") {
    updatedFiles.push(envFilePath);
  }

  const targets = await resolvePosixShellPathTargets(options.homeDir, options.shell, options.platform);

  for (const target of targets) {
    try {
      const block = target.kind === "fish"
        ? buildOpenClawFishPathBlock()
        : buildOpenClawPosixSourceBlock();
      const status = await upsertManagedBlock(target.filePath, block);

      if (status === "created") {
        createdFiles.push(target.filePath);
      } else if (status === "updated") {
        updatedFiles.push(target.filePath);
      }
    } catch (error) {
      warnings.push(`Could not update ${target.filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    updatedFiles,
    createdFiles,
    warnings
  };
}

async function ensureOpenClawWindowsUserPath(
  binDir: string,
  options: {
    currentUserPath?: string;
    runPowerShellScript?: (script: string) => Promise<string>;
  }
) {
  const runPowerShellScript = options.runPowerShellScript ?? runWindowsPowerShellScript;
  const warnings: string[] = [];
  let currentUserPath = options.currentUserPath;

  try {
    if (currentUserPath === undefined) {
      currentUserPath = await runPowerShellScript(
        "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; [Environment]::GetEnvironmentVariable('Path', 'User')"
      );
    }

    if (pathListIncludesDirectory(currentUserPath, binDir, "win32")) {
      return { updated: false, warnings };
    }

    const nextUserPath = mergeDirectoryIntoPathList(currentUserPath, binDir, "win32");
    await runPowerShellScript(
      `[Environment]::SetEnvironmentVariable('Path', ${toPowerShellSingleQuotedString(nextUserPath)}, 'User')`
    );

    return { updated: true, warnings };
  } catch (error) {
    warnings.push(`Could not update the Windows user PATH: ${error instanceof Error ? error.message : String(error)}`);
    return { updated: false, warnings };
  }
}

function getEnvPathValue(env: NodeJS.ProcessEnv, platform: NodeJS.Platform) {
  return env[getPathEnvKey(env, platform)];
}

function prependDirectoryToEnvPath(env: NodeJS.ProcessEnv, directory: string, platform: NodeJS.Platform) {
  const key = getPathEnvKey(env, platform);
  const currentValue = env[key];
  const nextValue = mergeDirectoryIntoPathList(currentValue, directory, platform);

  if (nextValue === (currentValue ?? "")) {
    return false;
  }

  env[key] = nextValue;
  return true;
}

function getPathEnvKey(env: NodeJS.ProcessEnv, platform: NodeJS.Platform) {
  if (platform !== "win32") {
    return "PATH";
  }

  return Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "Path";
}

function splitPathList(pathValue: string | undefined, platform: NodeJS.Platform) {
  const delimiter = platform === "win32" ? ";" : ":";
  return (pathValue ?? "")
    .split(delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizePathForComparison(value: string, platform: NodeJS.Platform) {
  const normalized = pathForPlatform(platform).normalize(value.replace(/^["']|["']$/g, "")).replace(/[\\/]+$/, "");
  return platform === "win32" ? normalized.toLowerCase() : normalized;
}

function pathForPlatform(platform: NodeJS.Platform) {
  return platform === "win32" ? path.win32 : path.posix;
}

function buildOpenClawPosixEnvFileContent() {
  return [
    "# Managed by AgentOS. Adds the OpenClaw local-prefix binary directory.",
    "case \":$PATH:\" in",
    "  *\":$HOME/.openclaw/bin:\"*) ;;",
    "  *) export PATH=\"$HOME/.openclaw/bin:$PATH\" ;;",
    "esac",
    ""
  ].join("\n");
}

function buildOpenClawPosixSourceBlock() {
  return [
    OPENCLAW_PATH_MARKER_START,
    `[ -f "$HOME/.openclaw/${OPENCLAW_POSIX_ENV_FILE_NAME}" ] && . "$HOME/.openclaw/${OPENCLAW_POSIX_ENV_FILE_NAME}"`,
    OPENCLAW_PATH_MARKER_END
  ].join("\n");
}

function buildOpenClawFishPathBlock() {
  return [
    OPENCLAW_PATH_MARKER_START,
    "if test -d \"$HOME/.openclaw/bin\"",
    "    fish_add_path \"$HOME/.openclaw/bin\"",
    "end",
    OPENCLAW_PATH_MARKER_END
  ].join("\n");
}

async function resolvePosixShellPathTargets(homeDir: string, shell: string, platform: NodeJS.Platform) {
  const shellName = path.basename(shell || "");
  const existingCommonFiles = await existingFiles([
    path.join(homeDir, ".zshrc"),
    path.join(homeDir, ".bashrc"),
    path.join(homeDir, ".bash_profile"),
    path.join(homeDir, ".profile")
  ]);
  const preferredFiles = preferredShellStartupFiles(homeDir, shellName, platform);
  const targets = preferredFiles.map((filePath) => ({
    filePath,
    kind: shellName === "fish" && filePath.endsWith(".fish") ? "fish" as const : "posix" as const
  }));

  for (const filePath of existingCommonFiles) {
    if (!targets.some((target) => target.filePath === filePath)) {
      targets.push({ filePath, kind: "posix" as const });
    }
  }

  return targets;
}

function preferredShellStartupFiles(homeDir: string, shellName: string, platform: NodeJS.Platform) {
  if (shellName === "fish") {
    return [path.join(homeDir, ".config", "fish", "conf.d", "openclaw.fish")];
  }

  if (shellName === "zsh") {
    return [path.join(homeDir, ".zshrc")];
  }

  if (shellName === "bash") {
    return platform === "darwin"
      ? [path.join(homeDir, ".bash_profile"), path.join(homeDir, ".bashrc")]
      : [path.join(homeDir, ".bashrc"), path.join(homeDir, ".profile")];
  }

  return [path.join(homeDir, ".profile")];
}

async function existingFiles(filePaths: string[]) {
  const existing: string[] = [];

  for (const filePath of filePaths) {
    if (await pathExists(filePath)) {
      existing.push(filePath);
    }
  }

  return existing;
}

async function upsertManagedBlock(filePath: string, block: string) {
  const existed = await pathExists(filePath);
  const current = existed ? await readFile(filePath, "utf8") : "";
  const next = replaceOrAppendManagedBlock(current, block);

  if (next === current) {
    return "unchanged" as const;
  }

  await writeTextFile(filePath, next);
  return existed ? "updated" as const : "created" as const;
}

function replaceOrAppendManagedBlock(current: string, block: string) {
  const normalizedBlock = block.endsWith("\n") ? block : `${block}\n`;
  const markerPattern = new RegExp(
    `${escapeRegExp(OPENCLAW_PATH_MARKER_START)}[\\s\\S]*?${escapeRegExp(OPENCLAW_PATH_MARKER_END)}\\n?`,
    "m"
  );

  if (markerPattern.test(current)) {
    return current.replace(markerPattern, normalizedBlock);
  }

  const prefix = current && !current.endsWith("\n") ? "\n" : "";
  const spacer = current.trim() ? "\n" : "";
  return `${current}${prefix}${spacer}${normalizedBlock}`;
}

async function writeTextFileIfChanged(filePath: string, content: string) {
  const existed = await pathExists(filePath);
  const current = existed ? await readFile(filePath, "utf8") : "";

  if (current === content) {
    return "unchanged" as const;
  }

  await writeTextFile(filePath, content);
  return existed ? "updated" as const : "created" as const;
}

async function writeTextFile(filePath: string, content: string) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
}

async function pathExists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toPowerShellSingleQuotedString(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function runWindowsPowerShellScript(script: string) {
  return new Promise<string>((resolve, reject) => {
    const executable = process.env.SystemRoot
      ? path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
      : "powershell.exe";
    const encodedCommand = Buffer.from(script, "utf16le").toString("base64");
    const child = spawn(executable, [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-EncodedCommand",
      encodedCommand
    ], {
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }

      reject(new Error(stderr.trim() || `PowerShell exited with code ${code ?? "unknown"}.`));
    });
  });
}

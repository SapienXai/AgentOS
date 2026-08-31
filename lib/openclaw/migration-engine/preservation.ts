import { lstat, readFile, readlink, readdir } from "node:fs/promises";
import path from "node:path";

import { hashFile } from "@/lib/openclaw/migration-engine/sqlite";

export type StatePreservationSnapshot = {
  stateFilePaths: string[];
  stateHashes: Record<string, string>;
  jsonIdentityValues: string[];
  transcriptEvents: number;
  workspaceHashes: Record<string, string>;
  configShape: string[];
};

export type StatePreservationComparison = {
  pass: boolean;
  checks: Array<{ id: string; pass: boolean; detail: string }>;
  source: StatePreservationSnapshot;
  target: StatePreservationSnapshot;
};

export async function captureStatePreservation(input: {
  stateDir: string;
  configPath: string;
  workspaceRelativePrefix?: string;
}): Promise<StatePreservationSnapshot> {
  const stateFiles: string[] = [];
  const stateHashes: Record<string, string> = {};
  const jsonIdentityValues = new Set<string>();
  let transcriptEvents = 0;
  const workspaceHashes: Record<string, string> = {};

  await walk(input.stateDir, async (filePath, relativePath) => {
    const metadata = await lstat(filePath);
    if (metadata.isSymbolicLink()) {
      const target = await readlink(filePath);
      stateFiles.push(relativePath);
      stateHashes[relativePath] = `symlink:${target}`;
      if (input.workspaceRelativePrefix && relativePath.startsWith(`${input.workspaceRelativePrefix}/`)) workspaceHashes[relativePath] = stateHashes[relativePath];
      return;
    }
    stateFiles.push(relativePath);
    stateHashes[relativePath] = await hashFile(filePath);
    if (relativePath.includes(".jsonl")) transcriptEvents += countLines(await readFile(filePath, "utf8"));
    if (input.workspaceRelativePrefix && relativePath.startsWith(`${input.workspaceRelativePrefix}/`)) {
      workspaceHashes[relativePath] = stateHashes[relativePath];
    }
    if (relativePath.endsWith(".json") || relativePath.includes(".jsonl") || relativePath.endsWith(".sqlite")) {
      collectIdentityValues(await readFile(filePath, "utf8"), jsonIdentityValues);
    }
  });

  const configShape: string[] = [];
  try {
    const config = JSON.parse(await readFile(input.configPath, "utf8")) as unknown;
    collectShape(config, "", configShape);
    collectIdentityValues(JSON.stringify(config), jsonIdentityValues);
  } catch {
    configShape.push("config:unavailable");
  }

  return {
    stateFilePaths: stateFiles.sort(),
    stateHashes,
    jsonIdentityValues: [...jsonIdentityValues].sort(),
    transcriptEvents,
    workspaceHashes,
    configShape: configShape.sort()
  };
}

export function compareStatePreservation(source: StatePreservationSnapshot, target: StatePreservationSnapshot): StatePreservationComparison {
  const sourceIdentities = new Set(source.jsonIdentityValues);
  const targetIdentities = new Set(target.jsonIdentityValues);
  const missingIdentityValues = [...sourceIdentities].filter((value) => !targetIdentities.has(value));
  const workspaceMismatches = Object.entries(source.workspaceHashes).filter(([relativePath, hash]) => target.workspaceHashes[relativePath] !== hash);
  const checks = [
    {
      id: "agent-session-cron-identities",
      pass: missingIdentityValues.length === 0,
      detail: missingIdentityValues.length === 0
        ? "Stable JSON identities from agents, sessions, automations, and configuration were preserved."
        : `Missing ${missingIdentityValues.length} stable identity value(s) after migration.`
    },
    {
      id: "workspace-files",
      pass: workspaceMismatches.length === 0,
      detail: workspaceMismatches.length === 0
        ? "Source workspace file hashes were preserved."
        : `Workspace file hash mismatch: ${workspaceMismatches.slice(0, 3).map(([relativePath]) => relativePath).join(", ")}.`
    },
    {
      id: "transcript-events",
      pass: target.transcriptEvents >= source.transcriptEvents,
      detail: target.transcriptEvents >= source.transcriptEvents
        ? `${source.transcriptEvents} source transcript event(s) remain represented after migration.`
        : `Transcript event count decreased from ${source.transcriptEvents} to ${target.transcriptEvents}.`
    },
    {
      id: "config-shape",
      pass: ["agents:", "gateway:", "models:"].every((prefix) => target.configShape.some((entry) => entry.startsWith(prefix))),
      detail: ["agents:", "gateway:", "models:"].every((prefix) => target.configShape.some((entry) => entry.startsWith(prefix)))
        ? "Core configuration shape was preserved while OpenClaw normalized owned keys."
        : "Target configuration lost a required core configuration section."
    }
  ];
  return { pass: checks.every((check) => check.pass), checks, source, target };
}

async function walk(root: string, visit: (filePath: string, relativePath: string) => Promise<void>, current = root): Promise<void> {
  const entries = await readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    const filePath = path.join(current, entry.name);
    const relativePath = path.relative(root, filePath);
    const metadata = await lstat(filePath);
    if (metadata.isDirectory()) await walk(root, visit, filePath);
    else if (metadata.isFile() || metadata.isSymbolicLink()) await visit(filePath, relativePath);
  }
}

function collectIdentityValues(raw: string, values: Set<string>) {
  const patterns = [
    /"(?:id|agentId|sessionId|jobId|cronId|key|model|workspace)"\s*:\s*"([^"\r\n]{1,180})"/g,
    /\b[0-9a-f]{8}-[0-9a-f-]{27,40}\b/gi,
    /\b(?:legacy-session-fixture|agentos-fixture|agentos-runtime-fixture)\b/gi
  ];
  for (const pattern of patterns) {
    for (const match of raw.matchAll(pattern)) {
      const value = match[1] ?? match[0];
      if (value && !looksSensitive(value)) values.add(value);
    }
  }
}

function collectShape(value: unknown, prefix: string, output: string[], depth = 0) {
  if (depth > 8 || !value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    output.push(`${prefix}:array`);
    for (const entry of value.slice(0, 32)) collectShape(entry, `${prefix}[]`, output, depth + 1);
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (looksSensitive(key)) continue;
    const current = prefix ? `${prefix}.${key}` : key;
    output.push(`${current}:${Array.isArray(entry) ? "array" : entry === null ? "null" : typeof entry}`);
    collectShape(entry, current, output, depth + 1);
  }
}

function countLines(value: string) {
  return value.split(/\r?\n/).filter((line) => line.trim()).length;
}

function looksSensitive(value: string) {
  return /token|secret|password|credential|apikey|private.?key/i.test(value);
}

import path from "node:path";

import { formatAgentDisplayName } from "@/lib/openclaw/presenters";
import { presentMissionDispatchRunnerLogEntry, readMissionDispatchRunnerLogs } from "@/lib/openclaw/domains/mission-dispatch-runner-logs";
import {
  isSyntheticDispatchRuntime
} from "@/lib/openclaw/domains/mission-dispatch-runtime";
import {
  resolveMissionDispatchCompletionDetail,
  resolveMissionDispatchIntegrityWarning,
  resolveMissionDispatchOutputFile,
  resolveMissionDispatchResultText,
  resolveMissionDispatchSummary
} from "@/lib/openclaw/domains/mission-dispatch-model";
import {
  extractCreatedFilesFromRuntimeMetadata,
  extractWarningsFromRuntimeMetadata,
  hashTaskKey
} from "@/lib/openclaw/domains/task-records";
import type { MissionControlSnapshot, RuntimeCreatedFile, RuntimeOutputRecord, RuntimeRecord, TaskFeedEvent, TaskRecord } from "@/lib/openclaw/types";
import type { MissionDispatchRecord } from "@/lib/openclaw/domains/mission-dispatch-lifecycle";

export function buildTaskFeed(
  task: TaskRecord,
  runs: RuntimeRecord[],
  outputsByRuntimeId: Map<string, RuntimeOutputRecord>,
  snapshot: MissionControlSnapshot
) {
  const agentNameById = new Map(snapshot.agents.map((agent) => [agent.id, formatAgentDisplayName(agent)]));
  const events: TaskFeedEvent[] = [];
  const sortedRuns = [...runs].sort((left, right) => (left.updatedAt ?? 0) - (right.updatedAt ?? 0));
  const hasAvailableOutput = Array.from(outputsByRuntimeId.values()).some(hasRuntimeOutputEvidence);
  let silentRuntimeCandidate: {
    runtime: RuntimeRecord;
    agentName: string | null;
    timestamp: string;
  } | null = null;
  const seenItemSignatures = new Set<string>();
  const seenStatusSignatures = new Set<string>();
  const seenWarningSignatures = new Set<string>();
  const seenCreatedFilePaths = new Set<string>();

  for (const runtime of sortedRuns) {
    if (task.dispatchId && isSyntheticDispatchRuntime(runtime)) {
      continue;
    }

    const output = outputsByRuntimeId.get(runtime.id);
    const agentName = runtime.agentId ? agentNameById.get(runtime.agentId) ?? null : null;
    const runtimeTimestamp = timestampFromRuntime(runtime, output?.finalTimestamp);

    if (output?.items.length) {
      for (const item of output.items) {
        const detail = summarizeText(item.text.trim() || output.errorMessage || runtime.subtitle, 220);
        const itemSignature = buildFeedContentSignature([
          "item",
          item.role,
          item.toolName ?? "",
          item.timestamp,
          detail
        ]);

        if (seenItemSignatures.has(itemSignature)) {
          continue;
        }

        seenItemSignatures.add(itemSignature);

        events.push(
          enrichTaskFeedEvent(
            {
              id: `${runtime.id}:${item.id}`,
              kind:
                item.role === "assistant"
                  ? "assistant"
                  : item.role === "toolCall" || item.role === "toolResult"
                    ? "tool"
                    : "user",
              timestamp: item.timestamp,
              title:
                item.role === "assistant"
                  ? agentName || "Agent update"
                  : item.role === "toolCall" || item.role === "toolResult"
                    ? item.toolName
                      ? `Tool · ${item.toolName}`
                      : "Tool update"
                    : "Mission",
              detail,
              runtimeId: runtime.id,
              agentId: runtime.agentId,
              toolName: item.toolName,
              isError: item.isError
            },
            {
              urlSources: [item.text, output?.finalText, output?.errorMessage, runtime.subtitle]
            }
          )
        );
      }
    } else {
      const detail = summarizeText(output?.errorMessage || runtime.subtitle, 220);

      if (isMissingTranscriptStatus(output, detail)) {
        if (!hasAvailableOutput && isRuntimeWaitingForOutput(runtime)) {
          silentRuntimeCandidate = {
            runtime,
            agentName,
            timestamp: runtimeTimestamp
          };
        }
        continue;
      }

      const statusSignature = buildFeedContentSignature(["status", runtime.status, detail]);
      if (seenStatusSignatures.has(statusSignature)) {
        continue;
      }

      seenStatusSignatures.add(statusSignature);
      const presentation = presentRuntimeStatusEvent(runtime, agentName, detail);

      events.push(
        enrichTaskFeedEvent(
          {
            id: `${runtime.id}:status`,
            kind: presentation.kind,
            timestamp: runtimeTimestamp,
            title: presentation.title,
            detail: presentation.detail,
            runtimeId: runtime.id,
            agentId: runtime.agentId,
            isError: presentation.isError
          },
          {
            urlSources: [output?.errorMessage, runtime.subtitle]
          }
        )
      );
    }

    const warningValues = uniqueStrings(
      (output?.warnings ?? []).concat(extractWarningsFromRuntimeMetadata(runtime))
    );
    for (const warning of warningValues) {
      const warningSignature = buildFeedContentSignature(["warning", warning]);
      if (seenWarningSignatures.has(warningSignature)) {
        continue;
      }

      seenWarningSignatures.add(warningSignature);

      events.push(
        enrichTaskFeedEvent(
          {
            id: `${runtime.id}:warning:${hashTaskKey(warning)}`,
            kind: "warning",
            timestamp: runtimeTimestamp,
            title: "Fallback",
            detail: summarizeText(warning, 220),
            runtimeId: runtime.id,
            agentId: runtime.agentId
          },
          {
            urlSources: [warning]
          }
        )
      );
    }

    const createdFiles = dedupeCreatedFiles(
      (output?.createdFiles ?? []).concat(extractCreatedFilesFromRuntimeMetadata(runtime))
    );
    for (const file of createdFiles) {
      if (seenCreatedFilePaths.has(file.path)) {
        continue;
      }

      seenCreatedFilePaths.add(file.path);

      events.push(
        enrichTaskFeedEvent(
          {
            id: `${runtime.id}:artifact:${hashTaskKey(file.path)}`,
            kind: "artifact",
            timestamp: runtimeTimestamp,
            title: "Created file",
            detail: file.displayPath,
            runtimeId: runtime.id,
            agentId: runtime.agentId
          },
          {
            file
          }
        )
      );
    }
  }

  if (silentRuntimeCandidate && !events.some((event) => hasOutputFeedEvidence(event))) {
    const silentRuntimeEvent = presentSilentRuntimeEvent(
      silentRuntimeCandidate.runtime,
      silentRuntimeCandidate.agentName
    );

    events.push(
      enrichTaskFeedEvent(
        {
          id: `${silentRuntimeCandidate.runtime.id}:waiting-for-output`,
          kind: "status",
          timestamp: silentRuntimeCandidate.timestamp,
          title: silentRuntimeEvent.title,
          detail: silentRuntimeEvent.detail,
          runtimeId: silentRuntimeCandidate.runtime.id,
          agentId: silentRuntimeCandidate.runtime.agentId,
          isError: false
        },
        {
          urlSources: [silentRuntimeCandidate.runtime.subtitle]
        }
      )
    );
  }

  if (events.length === 0 && task.mission && !task.dispatchId) {
    events.push(
      enrichTaskFeedEvent(
        {
          id: `${task.id}:mission`,
          kind: "user",
          timestamp: timestampFromUnix(task.updatedAt),
          title: "Mission",
          detail: summarizeText(task.mission, 220),
          agentId: task.primaryAgentId
        },
        {
          urlSources: [task.mission]
        }
      )
    );
  }

  return events
    .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp))
    .slice(-36);
}

export async function buildMissionDispatchFeed(
  task: TaskRecord,
  record: MissionDispatchRecord | null,
  snapshot: MissionControlSnapshot
) {
  if (!record) {
    return [] as TaskFeedEvent[];
  }

  const agentName = formatAgentDisplayName(
    snapshot.agents.find((agent) => agent.id === task.primaryAgentId) ?? { name: "OpenClaw" }
  );
  const runnerLogs = await readMissionDispatchRunnerLogs(record);
  const runnerLogFile =
    record.runner.logPath && record.runner.logPath.trim()
      ? {
          path: record.runner.logPath,
          displayPath: path.basename(record.runner.logPath)
        }
      : null;
  const events: TaskFeedEvent[] = [
    enrichTaskFeedEvent(
      {
        id: `${record.id}:accepted`,
        kind: "user",
        timestamp: record.submittedAt,
        title: "Mission accepted",
        detail: summarizeText(task.mission || record.mission || "Mission queued for dispatch.", 220),
        agentId: task.primaryAgentId
      },
      {
        urlSources: [task.mission, record.mission, record.routedMission]
      }
    )
  ];

  if (record.runner.startedAt || record.runner.pid) {
    events.push(
      enrichTaskFeedEvent(
        {
          id: `${record.id}:runner-started`,
          kind: "status",
          timestamp: record.runner.startedAt ?? record.updatedAt,
          title: "Dispatch runner started",
          detail: record.outputDirRelative
            ? `Preparing the first OpenClaw runtime in ${record.outputDirRelative}.`
            : "Preparing the first OpenClaw runtime."
        },
        {
          file:
            record.outputDir && record.outputDirRelative
              ? {
                  path: record.outputDir,
                  displayPath: record.outputDirRelative
                }
              : null
        }
      )
    );
  }

  if (record.runner.lastHeartbeatAt) {
    const shouldShowHeartbeat = !record.observation.observedAt && record.status !== "completed";

    if (shouldShowHeartbeat) {
      events.push(
        enrichTaskFeedEvent(
          {
            id: `${record.id}:heartbeat`,
            kind: "status",
            timestamp: record.runner.lastHeartbeatAt,
            title: "Heartbeat received",
            detail: `${agentName} is online. Waiting for the first runtime session.`
          },
          {
            urlSources: [agentName, record.outputDirRelative]
          }
        )
      );
    }
  }

  if (record.observation.observedAt && record.status !== "completed") {
    events.push(
      enrichTaskFeedEvent(
        {
          id: `${record.id}:runtime-observed`,
          kind: "status",
          timestamp: record.observation.observedAt,
          title: "Runtime observed",
          detail: "OpenClaw observed a runtime. Waiting for the first output update."
        },
        {
          urlSources: [record.outputDirRelative]
        }
      )
    );
  }

  if (record.status === "completed") {
    const finalResponseText =
      typeof task.metadata.finalResponseText === "string" ? task.metadata.finalResponseText.trim() : "";
    const completionSummary = resolveMissionDispatchSummary(record) || resolveMissionDispatchResultText(record) || finalResponseText;
    const outputFile = resolveMissionDispatchOutputFile(record);
    events.push(
      enrichTaskFeedEvent(
        {
          id: `${record.id}:completed`,
          kind: "status",
          timestamp: record.runner.finishedAt ?? record.updatedAt,
          title: completionSummary ? "Mission finished" : "Dispatch runner finished",
          detail: summarizeText(completionSummary || resolveMissionDispatchCompletionDetail(record), 220)
        },
        {
          urlSources: [completionSummary, resolveMissionDispatchCompletionDetail(record), record.outputDirRelative],
          file:
            outputFile ??
            (record.outputDir && record.outputDirRelative
              ? {
                  path: record.outputDir,
                  displayPath: record.outputDirRelative
                }
              : null)
        }
      )
    );
  }

  if (record.status === "cancelled") {
    events.push(
      enrichTaskFeedEvent(
        {
          id: `${record.id}:cancelled`,
          kind: "warning",
          timestamp: record.runner.finishedAt ?? record.updatedAt,
          title: "Mission cancelled",
          detail: summarizeText(resolveMissionDispatchCompletionDetail(record), 220),
          isError: false
        },
        {
          urlSources: [record.error, record.outputDirRelative],
          file:
            record.outputDir && record.outputDirRelative
              ? {
                  path: record.outputDir,
                  displayPath: record.outputDirRelative
                }
              : null
        }
      )
    );
  }

  const integrityWarning = resolveMissionDispatchIntegrityWarning(record);

  if (integrityWarning) {
    events.push(
      enrichTaskFeedEvent(
        {
          id: `${record.id}:integrity-warning`,
          kind: "warning",
          timestamp: record.runner.finishedAt ?? record.updatedAt,
          title: "Result needs review",
          detail: summarizeText(integrityWarning, 220),
          isError: true
        },
        {
          urlSources: [record.outputDirRelative],
          file:
            record.outputDir && record.outputDirRelative
              ? {
                  path: record.outputDir,
                  displayPath: record.outputDirRelative
                }
              : null
        }
      )
    );
  }

  if (record.status === "stalled") {
    const stalledPresentation = presentMissionDispatchStalledEvent(record, agentName);

    events.push(
      enrichTaskFeedEvent(
        {
          id: `${record.id}:stalled`,
          kind: stalledPresentation.kind,
          timestamp: record.updatedAt,
          title: stalledPresentation.title,
          detail: summarizeText(stalledPresentation.detail, 220),
          isError: stalledPresentation.isError
        },
        {
          urlSources: [record.error, record.outputDirRelative]
        }
      )
    );
  }

  for (const entry of runnerLogs) {
    const presentation = presentMissionDispatchRunnerLogEntry(entry);

    if (!presentation) {
      continue;
    }

    events.push(
      enrichTaskFeedEvent(
        {
          id: entry.id,
          kind: presentation.kind,
          timestamp: entry.timestamp,
          title: presentation.title,
          detail: summarizeText(presentation.detail, 220),
          agentId: task.primaryAgentId,
          isError: presentation.isError
        },
        {
          file: runnerLogFile
        }
      )
    );
  }

  return events;
}

export function mergeTaskFeedEvents(...feeds: TaskFeedEvent[][]) {
  const deduped = new Map<string, TaskFeedEvent>();

  for (const event of feeds.flat()) {
    deduped.set(event.id, event);
  }

  return [...deduped.values()]
    .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp))
    .slice(-48);
}

function enrichTaskFeedEvent(
  event: TaskFeedEvent,
  options?: {
    urlSources?: Array<string | null | undefined>;
    file?: RuntimeCreatedFile | null;
  }
): TaskFeedEvent {
  const url = extractFirstUrlFromSources(options?.urlSources ?? []);

  return {
    ...event,
    ...(url ? { url } : {}),
    ...(options?.file ? { filePath: options.file.path, displayPath: options.file.displayPath } : {})
  };
}

function hasRuntimeOutputEvidence(output: RuntimeOutputRecord) {
  return (
    output.status === "available" ||
    output.items.length > 0 ||
    Boolean(output.finalText?.trim()) ||
    output.createdFiles.length > 0
  );
}

function isMissingTranscriptStatus(output: RuntimeOutputRecord | undefined, detail: string) {
  return (
    output?.status === "missing" ||
    isMissingTranscriptMessage(detail)
  );
}

function isMissingTranscriptMessage(detail: string | null | undefined) {
  return (
    typeof detail === "string" &&
    (/No transcript file was found for this runtime session/i.test(detail) ||
      /No transcript entries were found for this runtime/i.test(detail))
  );
}

function isRuntimeWaitingForOutput(runtime: RuntimeRecord) {
  return runtime.status === "queued" || runtime.status === "running" || runtime.status === "stalled";
}

function hasOutputFeedEvidence(event: TaskFeedEvent) {
  return event.kind === "assistant" || event.kind === "tool" || event.kind === "artifact";
}

function presentRuntimeStatusEvent(runtime: RuntimeRecord, agentName: string | null, detail: string) {
  const subject = agentName || "Run";

  if (runtime.status === "stalled") {
    return {
      kind: "warning" as const,
      title: `${subject} · needs attention`,
      detail,
      isError: true
    };
  }

  return {
    kind: "status" as const,
    title: `${subject} · ${runtime.status}`,
    detail,
    isError: false
  };
}

function presentSilentRuntimeEvent(runtime: RuntimeRecord, agentName: string | null) {
  const subject = agentName || "Agent";

  if (runtime.status === "running") {
    return {
      title: `${subject} · working silently`,
      detail: "The runtime is live, but no transcript output has been captured yet. The first assistant, tool, or file update will stream here."
    };
  }

  return {
    title: `${subject} · waiting for output`,
    detail: "AgentOS has not captured transcript output yet. This can happen while the agent is starting, attaching a session, or writing its first update."
  };
}

function presentMissionDispatchStalledEvent(record: MissionDispatchRecord, agentName: string) {
  const missingTranscriptError = isMissingTranscriptMessage(record.error);
  const hasRuntimeEvidence = Boolean(record.observation.observedAt || record.runner.lastHeartbeatAt);
  const isSoftStall = missingTranscriptError || (!record.error && hasRuntimeEvidence);

  if (isSoftStall) {
    return {
      kind: "status" as const,
      title: missingTranscriptError ? "Waiting for output" : "Working silently",
      detail: missingTranscriptError
        ? `${agentName} has a runtime, but AgentOS has not captured transcript output yet. Updates will stream here when the session writes its first entry.`
        : `${agentName} is still being observed, but no transcript output has arrived yet. AgentOS will keep the feed attached.`,
      isError: false
    };
  }

  return {
    kind: "warning" as const,
    title: "Needs attention",
    detail:
      record.error ||
      (record.runner.lastHeartbeatAt
        ? "OpenClaw stopped reporting progress while waiting for the first runtime."
        : "OpenClaw did not produce the first heartbeat in time."),
    isError: true
  };
}

function buildFeedContentSignature(parts: Array<string | null | undefined>) {
  return parts
    .map((part) => normalizeSignaturePart(part ?? ""))
    .join("|");
}

function normalizeSignaturePart(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function extractFirstUrlFromSources(sources: Array<string | null | undefined>) {
  for (const source of sources) {
    if (typeof source !== "string") {
      continue;
    }

    const match = source.match(/https?:\/\/[^\s<>"'`]+/i);

    if (!match) {
      continue;
    }

    const normalized = stripTrailingUrlPunctuation(match[0]);

    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function stripTrailingUrlPunctuation(value: string) {
  return value.replace(/[)\].,;:!?]+$/g, "");
}

function timestampFromRuntime(runtime: RuntimeRecord, preferred?: string | null) {
  if (preferred) {
    return preferred;
  }

  return timestampFromUnix(runtime.updatedAt);
}

function timestampFromUnix(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? new Date(value).toISOString()
    : new Date().toISOString();
}

function dedupeCreatedFiles(files: RuntimeCreatedFile[]) {
  const seen = new Set<string>();
  const deduped: RuntimeCreatedFile[] = [];

  for (const file of files) {
    if (!file.path || seen.has(file.path)) {
      continue;
    }

    seen.add(file.path);
    deduped.push(file);
  }

  return deduped;
}

function summarizeText(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(maxLength - 1, 1)).trimEnd()}…`;
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

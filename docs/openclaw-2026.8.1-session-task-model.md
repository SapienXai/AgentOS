# AgentOS / OpenClaw 2026.8.1 Session and Task Model

## Scope

Phase 5A aligns AgentOS session and task views with the exact OpenClaw 2026.8.1 Gateway contract. OpenClaw remains the source of truth for runtime sessions, tasks, runs, task status, and Gateway control. AgentOS keeps only the projections and bootstrap metadata needed to present and operate those runtime objects.

This document describes the pinned 2026.8.1 contract at source commit `ea806575e6450e4d1efdfc72c19f04be982a1b9b`. It does not describe OpenClaw `main` or a newer release.

## Exact OpenClaw 8.1 session model

The native Gateway surfaces used by AgentOS are:

| Method | Contract role | AgentOS use |
| --- | --- | --- |
| `sessions.list` | Session index and session metadata | Session/runtime projection and exact correlation |
| `sessions.create` | Create or adopt a session by exact key | Mission/session dispatch |
| `sessions.describe` | Describe one exact session | Session detail and verification |
| `sessions.send` | Send work to an existing session | Native runtime dispatch |
| `sessions.abort` | Abort an exact run/session target | Abort fallback when no task ID exists |
| `sessions.patch` | Patch an exact session | Runtime/session mutation, subject to target authorization |
| `sessions.assignOwner` | Assign an owner where the caller is authorized | Session ownership control; this is not task assignment |
| `sessions.subscribe` / `sessions.messages.subscribe` | Runtime events and transcript/event subscription | Live state where the existing AgentOS surface subscribes |

The session index exposes exact keys/IDs and, where available, `createdActor`, `owner`, `participants`, participant count, `sharingRole`, and `visibility`. `hasActiveRun` is the aggregate active-run signal; `activeRunIds` is used only when the Gateway provides it. AgentOS correlates a session only by the exact key or ID returned by the Gateway or by the request that created it. It never selects the first session row as a fallback.

`sessions.create` stamps a newly created row with `createdVia`, `createdActor`, and `createdAt`. Adopting an existing key does not restamp its creator. The returned/persisted key is the canonical continuation reference.

Session visibility, ownership, participants, and target-sensitive mutation remain OpenClaw runtime policy. AgentOS does not create a second authoritative session ACL.

## Exact OpenClaw 8.1 task model

The pinned Gateway exposes these task methods:

| Method | Required capability | Contract role |
| --- | --- | --- |
| `tasks.list` | `operator.read` | List task ledger summaries; supports status, agent, session key, limit, and cursor filters |
| `tasks.get` | `operator.read` | Read one exact task by `taskId`; missing IDs return not-found |
| `tasks.cancel` | `operator.write` | Cancel one exact task by `taskId`, with an optional reason |

The task list response is `{ tasks: TaskSummary[], nextCursor? }`. A task summary may contain `id`, `status`, `kind`, `runtime`, `title`, `agentId`, `sessionKey`, `childSessionKey`, `ownerKey`, `runId`, `taskId`, `flowId`, `parentTaskId`, `sourceId`, timestamps, progress, terminal summary, and sanitized error information.

The exact task statuses are `queued`, `running`, `completed`, `failed`, `cancelled`, and `timed_out`. AgentOS preserves the exact status in metadata and maps `failed` and `timed_out` to its existing `stalled` presentation state. Unknown status values are presented as unknown/stalled rather than being treated as successful or running.

There is no `tasks.assign` method in the pinned 2026.8.1 Gateway contract. The compatibility interface retains an explicit unsupported operation for callers that still expose assignment-shaped code, but both native and CLI clients reject it before transport. `sessions.assignOwner` is a separate session operation and must not be described as task assignment.

## Source-of-truth matrix

| Surface | Authoritative source | AgentOS representation | Sidecar/compatibility role |
| --- | --- | --- | --- |
| Session identity and metadata | `sessions.list` / `sessions.describe` | Runtime/session projection | Mission dispatch may retain request correlation |
| Task identity and status | `tasks.list` / `tasks.get` | Normalized task/runtime projection | Dispatch sidecar is bootstrap/provenance only until a native task exists |
| Task cancellation | `tasks.cancel` | AgentOS abort result and refreshed projection | No sidecar fallback |
| Run/session abort without a task ID | `sessions.abort` | AgentOS control result | Exact session/run correlation is required |
| Mission submission | `sessions.create` plus native send/turn path | Dispatch record and runtime projection | Dispatch record is not runtime truth |
| AgentOS audit attribution | AgentOS audit envelope | Actor/operation/target/result | AgentOS-owned, not an OpenClaw task/session substitute |

When a native task ledger row exists, its task ID and exact task status take precedence over stale dispatch or ambient runtime observations. A native task and a session/runtime observation may project into one AgentOS task record; the native task identity is the primary identity and the duplicate runtime IDs remain correlation metadata.

## Execution identity and provenance

AgentOS uses a typed execution identity envelope containing the OpenClaw task ID, session key/ID, run ID, agent ID, workspace ID, optional AgentOS dispatch ID, and provenance. Provenance is one of:

- `authoritative`: exact task/session/run identity came from the native Gateway contract;
- `correlated`: an existing runtime/dispatch observation provides a usable exact reference but not a native task ledger proof;
- `derived`: an exact reference was derived from an existing structured runtime field;
- `heuristic`: an older compatibility signal is present but is not safe for privileged control.

Follow-up and continue operations reuse the canonical execution identity when present. A derived or heuristic target is not silently upgraded to high-confidence native identity. The existing warning/disabled behavior remains for targets that do not expose an exact session or task reference.

## Mission dispatch

Mission dispatch may create an AgentOS dispatch sidecar before the Gateway accepts work. Its generated identifier is a bootstrap correlation ID, not an OpenClaw task ID and not a canonical session ID. The native session key returned or confirmed by OpenClaw is authoritative after acceptance.

The sidecar remains useful for submission progress, recovery diagnostics, and compatibility with older runtime observations. It cannot overwrite a native task's terminal/running status. If the Gateway has not produced a task ledger row, AgentOS may present the sidecar/runtime projection with lower provenance and must not claim native task identity.

## Session correlation and restart continuity

AgentOS stores and reuses exact session keys/IDs from Gateway responses and task summaries. After reconnect/restart, it re-reads the session index and matches the exact requested/returned key. It does not create a replacement session merely because a sidecar or in-memory observation was lost.

The isolated certification harness creates one disposable exact 8.1 session, verifies it through list/describe, restarts the disposable Gateway with the same isolated state, reconnects, and verifies that the same exact session key remains singular. No existing user Gateway or provider credential is used.

## Task projection and controls

The Mission Control snapshot loader now passes the native `tasks.list` payload into runtime reconciliation. Native task records are normalized before task grouping, so status and identity are available even when no matching live session event is present.

Control behavior is bounded as follows:

- continue/follow-up reuses an exact session key/ID from the execution identity when one exists;
- abort uses `tasks.cancel` for an exact task ID;
- abort uses `sessions.abort` only when an exact run/session target exists and no task ID is available;
- task assignment is unsupported in 8.1 and fails closed without Gateway or CLI transport;
- no control action is authorized solely by a fabricated or first-row session reference.

## Multi-user semantics

Phase 4B's trusted-team model remains unchanged. AgentOS currently uses a shared trusted backend Gateway credential, so a runtime call made through that connection is attributed by OpenClaw to the shared service operator. AgentOS audit records retain the authenticated human actor separately. This phase does not claim per-human OpenClaw credentials or runtime creator attribution.

AgentOS product policy must still run before any shared service transport. A member cannot inherit the service connection's administrative authority. This session/task alignment does not introduce per-user OpenClaw delegation or hostile-tenant isolation.

## Stale state and remaining compatibility heuristics

Native task status wins stale dispatch and runtime status. Native task identity wins duplicate grouping. Dispatch status remains a compatibility signal only while no native task status is available. Runtime-derived session/task references remain visible as lower-confidence diagnostics for existing data, but they are not evidence that OpenClaw created a corresponding task ledger row.

The task list client accepts the historical `sessionId` input for compatibility and maps it to the exact 8.1 `sessionKey` request field. New code should use `sessionKey`.

The existing CLI fallback remains available for supported task list/get/cancel operations when the native Gateway path is unavailable. Task assignment has no CLI fallback in this phase because the exact 8.1 contract does not expose the operation.

## Known limitations and next phase

The disposable 8.1 runtime fixture used for certification does not include a model/provider turn, so it may produce an empty task ledger. The harness records that as an observed fixture limitation and never fabricates a task ID. A model-backed task-producing runtime test belongs with the Phase 5B automation/cron and conversation-bound work.

This phase does not redesign sessions, tasks, cron, automations, or conversation ownership. It establishes the source-of-truth and correlation boundary required before that work.

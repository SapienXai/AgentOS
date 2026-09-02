# OpenClaw 2026.8.1 Automation and Cron Model

> Historical 2026.8.1 artifact. The active certified AgentOS baseline is OpenClaw 2026.8.2; see [the current model/provider architecture](openclaw-2026.8.2-model-provider-architecture.md).

This document describes the bounded Phase 5B automation boundary in AgentOS. OpenClaw 2026.8.1 remains the scheduler and runtime source of truth. AgentOS projects that state into Operations, Mission Control, and audit surfaces.

## Exact 8.1 contract

The pinned 2026.8.1 Gateway exposes these cron methods:

`cron.status`, `cron.list`, `cron.get`, `cron.add`, `cron.update`, `cron.remove`, `cron.run`, and `cron.runs`.

The exact packaged 8.1 contract uses `id` for a cron job target. `cron.add` returns a `CronJob` or a response containing `job`; the authoritative job identity is `job.id`. `cron.run` is enqueue-style. A successful enqueue returns `runId`; terminal execution is observed by polling `cron.runs`, optionally filtered by the exact `id` and `runId`. A run status is `ok`, `error`, or `skipped`; completion status and delivery status are separate fields.

AgentOS sends the native 8.1 cron shape: `schedule` uses `at`, `everyMs`, or `expr`; the execution is an `agentTurn` payload; `sessionTarget`, `wakeMode`, `delivery`, and `deleteAfterRun` are explicit. Planner-created automations carry a stable `declarationKey`, so a repeated deploy can converge on the same OpenClaw job instead of creating an unbounded duplicate.

The source evidence is the exact 8.1 package under test, particularly `dist/cron-*.js`, `dist/*types*.d.ts`, and `docs/gateway/protocol.md`. No OpenClaw `main`-only method is used.

## Identity vocabulary and provenance

These identifiers are deliberately distinct:

| Identifier | Meaning | Authority |
| --- | --- | --- |
| AgentOS automation ID | Stable AgentOS product/correlation key | AgentOS product metadata |
| OpenClaw cron job ID | Persistent scheduled-job identity | OpenClaw `cron.list/get/add` |
| OpenClaw cron run ID | One enqueue/execution instance | OpenClaw `cron.run/runs` |
| `sessionKey` | Runtime conversation/session routing key | OpenClaw job/run response |
| `sessionId` | Runtime session record identity | OpenClaw job/run response |
| OpenClaw task ID | Background task identity, when exposed | OpenClaw `tasks.list/get` |
| AgentOS dispatch ID | Request/bootstrap correlation | AgentOS; never runtime authority |

The shared execution identity type uses four provenance values:

- `authoritative`: an exact OpenClaw task or cron run/job identifier was observed;
- `correlated`: an exact session or AgentOS dispatch was correlated;
- `derived`: a safe projection was derived from authoritative data;
- `heuristic`: legacy compatibility matching only.

No prompt, title, timestamp, first-row, or fabricated task identity is treated as authoritative.

## Source-of-truth matrix

| Surface | Authoritative source | AgentOS role | Sidecar role |
| --- | --- | --- | --- |
| Job definition/status | OpenClaw `cron.list/get/status` | UI and product projection | Workspace/safety/audit metadata |
| Run history | OpenClaw `cron.runs` | Operation timeline and health | Cached transcript result only |
| Run enqueue | OpenClaw `cron.run` response | Accept request and expose `runId` | Audit request/result |
| Session identity | Exact `sessionKey/sessionId` returned by OpenClaw | Conversation/task correlation | None |
| Background task | OpenClaw `tasks.list/get` | Task card/cancel when exact ID exists | None |
| Planner declaration | AgentOS planner automation ID and `declarationKey` | Idempotent convergence key | None |
| Dispatch | AgentOS dispatch record | Recovery/audit correlation | Never overrides native runtime state |

Projection precedence is: native task, exact cron run, exact session/run, correlated dispatch, then legacy compatibility heuristic. A lower-precedence projection cannot overwrite a higher-precedence native status or identity.

## Conversation-bound recurring execution

AgentOS Operations defaults to `sessionTarget: isolated`, matching the current product safety model. In exact 8.1, isolated cron execution creates a per-run session key derived from the job key and run session identity (the packaged runtime uses the `agent:<agent>:cron:<job>:run:<session>` form). Recurring isolated runs therefore do not inherently reuse one conversation session.

Conversation-bound work must use an exact OpenClaw target that provides it: `main`, `current`, or an explicit `session:<key>`, subject to OpenClaw visibility and authorization. AgentOS does not relabel isolated per-run sessions as one continuous conversation. If a future feature needs conversation reuse, it must choose and test that native target explicitly.

## Native task integration and cancellation

Every cron execution is correlated to `tasks.list/get` only when OpenClaw exposes an exact task ID. Fast loopback executions may have no task ledger row; AgentOS records that observation and does not invent a task ID. `tasks.cancel` is used only with an exact native task identity. Exact 8.1 does not advertise a general cron-run cancellation RPC, so the Operations `cancel` action fails closed rather than pretending that deleting or disabling a job cancels an already queued run.

## Controls and continuity

Operations uses native Gateway calls for create/add, update, enable/disable, remove, manual run, status, and history. `cron.run` is not treated as a synchronous completion response. History is polled by exact identifiers. Unsupported or unverified mutation surfaces remain unavailable; the old broad CLI fallback is not used as a scheduler authority.

The Operations sidecar uses an atomic temp-file rename and a process-local mutation queue for read-modify-write operations. This prevents overlapping writes in the supported single AgentOS process deployment. Multi-replica concurrent writers still require a shared lock or database and are not claimed here.

Planner automation provisioning carries a declaration key. OpenClaw owns deduplication/convergence for that key; AgentOS stores the resulting cron job ID after the native call. Restart/reconnect reads the job and run history again from OpenClaw and does not replay a run merely because it was not present in a transient AgentOS projection.

## Trusted-team authorization

The Phase 4B trusted-team model remains in force: one shared backend Gateway credential may be privileged, but it is not a human identity. Public Operations reads require runtime access. Operations mutations and planner deployment of enabled automations require the AgentOS `automations.manage` product permission, which is owner-only for human users. A member cannot reach the shared privileged transport for automation control. OpenClaw granted scopes and target/runtime authorization remain the final runtime enforcement point.

AgentOS audit entries retain the human actor, authentication method, operation, target job ID, result, and request ID. They do not contain Gateway tokens, passwords, cookies, prompts, or session content.

## Known limitations and deferred work

Exact 8.1 does not provide a safe per-human persistent Gateway credential path in the current AgentOS integration. OpenClaw runtime attribution is therefore shared-service while AgentOS audit attribution remains per human. OpenClaw does not currently provide a general cron-run cancellation method. Isolated recurring execution is per run, not conversation-bound by default. Task records are runtime-dependent and may be absent for fast executions.

Multi-user conversation/task redesign, native per-human Gateway delegation, hostile-tenant isolation, and provider/secrets redesign remain deferred. Mutually untrusted tenants must not share this AgentOS/OpenClaw runtime boundary.

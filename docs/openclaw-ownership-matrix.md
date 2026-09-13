# AgentOS / OpenClaw Ownership Matrix

Status: repository decision record, aligned to the locally certified OpenClaw
`2026.9.4` target as of `2026-09-12`. This is a bounded ownership index, not a
replacement for the compatibility audit or live Gateway status.

## Reading the matrix

The owner column uses the approved five-way classification:

| Class | Meaning |
| --- | --- |
| **A — AgentOS-owned** | Product intent, operator policy, audit/correlation metadata, or an explicitly separate AgentOS sidecar. It must not become OpenClaw runtime truth. |
| **B — Native OpenClaw** | OpenClaw owns the runtime, lifecycle, persistence, authorization, or contract. AgentOS consumes it through the adapter/client boundary. |
| **C — AgentOS projection / operator UX** | A normalized view, cache, diagnostic, recovery explanation, or control surface derived from native facts. It is not authoritative. |
| **D — Genuinely missing** | A bounded capability or AgentOS exposure that is not available enough to claim support. Keep it explicit; do not fake it with local state. |
| **E — Obsolete / duplicate** | A proposed second authority that would duplicate an OpenClaw runtime, registry, lifecycle, migration, or update behavior. Do not add it. |

Integration status is deliberately short: `native`, `fallback`, `unsupported`,
or `degraded`. A combined value means the preferred path and its explicit
recovery path are both relevant.

## Provenance boundary

**Certified 2026.9.4 evidence (`C94`)** is dated repository evidence generated
against an exact disposable OpenClaw package: tag `v2026.9.4`, signed tag object
`8bec206f3c1f787e1e9c45cfd34d3de2a78c7b8e`, peeled source commit
`3a9d69db306cd7f081e06254cb89c4bcc14a7107`, build
`2026.9.4-release-3a9d69db306c-2026-09-10T22-53-16.719Z`, Gateway protocol v4,
state schema 17, and agent schema 19. Start with the [2026.9.4 compatibility
audit](openclaw-2026.9.4-compatibility-audit.md) and its [exact contract
diff](evidence/openclaw-2026.9.3-to-2026.9.4-contract-diff.json).

The evidence artifacts record their own historical AgentOS code heads. They
prove the dated 9.4 certification runs, not runtime certification of this
matrix commit. The code links below are the current checkout implementation.
No live Gateway, provider, channel login, hosted deployment, or production
rollout is implied by this document.

**Future/current-main signal (`MAIN-SIGNAL`)** is not certified target
evidence. The [Gateway sync audit](openclaw-sync-audit.md) records upstream
`main` source expectations from an earlier pass, and the [native workspace
decision](openclaw-native-workspace-foundation.md) records that upstream `main`
was inspected for drift without promoting unreleased behavior. Re-check the
exact supported package before using any such signal for implementation.

No GitHub issue status was changed, and external issues were not mutated.

## Ownership matrix

| Concern | Owner | Source of truth | C94 evidence / current code | Integration status | Next bounded action |
| --- | --- | --- | --- | --- | --- |
| Mission intent, worker role, and AgentOS sidecar | A | AgentOS mission request plus the worker-profile sidecar in `.openclaw/project.json`; native agent/runtime facts remain OpenClaw-owned. | [C94 workspace foundation](openclaw-native-workspace-foundation.md); [agent service](../lib/openclaw/application/agent-service.ts); [worker profile](../lib/agentos/worker-profile.ts) | native | Keep role/mission/policy metadata separate from shared OpenClaw bootstrap context. |
| Worker lifecycle | B | OpenClaw Gateway, agents, sessions, runtime, and native supervisor. | [C94 lifecycle](evidence/openclaw-2026.9.4-lifecycle-certification.json); [runtime service](../lib/openclaw/application/runtime-service.ts); [runtime state](../lib/openclaw/application/runtime-state-service.ts) | native | Extend only through an observed 9.4 Gateway method/event and a focused contract test. |
| Retries, reconnect, and mutation ambiguity | B | OpenClaw transport/lifecycle semantics; AgentOS request policy may coalesce reads and perform one authoritative reread, but never owns a second retry ledger. | [C94 official transport](evidence/openclaw-2026.9.4-official-transport-certification.json); [official coordinator](../lib/openclaw/client/official-gateway-coordinator.ts); [request policy](../lib/openclaw/client/gateway-request-policy.ts) | native + degraded | Preserve native reconnect ownership and reconcile ambiguous mutations once; do not blindly retry a sent mutation. |
| Recovery and repair | B | OpenClaw Doctor, health/status, restart/suspend, update recovery, and rollback state. | [C94 Doctor/recovery](evidence/openclaw-2026.9.4-doctor-update-recovery.json); [Doctor service](../lib/openclaw/application/native-doctor-service.ts); [recovery decision](openclaw-native-doctor-update-recovery.md) | native + fallback | Keep CLI repair explicit and observable where Gateway self-control is unavailable; retain failed-after-rollback as failure. |
| Delegation and mission dispatch | B | OpenClaw `chat.send` / `sessions.send` and the returned native session/run identity; AgentOS owns intent and permissions only. | [C94 session/task alignment](evidence/openclaw-2026.9.4-session-task-alignment.json); [native client](../lib/openclaw/client/native-ws-gateway-client.ts); [mission workflow](../lib/openclaw/domains/mission-dispatch-workflow.ts) | native + fallback | Keep native dispatch first, with visible CLI fallback only for unsupported/older Gateway paths. |
| Lineage and correlation | B | OpenClaw task/session `id`, `runId`, `parentTaskId`, `sourceId`, `sessionKey`, and `sessionId`; AgentOS dispatch IDs are correlation metadata. | [C94 session/task model](evidence/openclaw-2026.9.4-session-task-alignment.json); [task records](../lib/openclaw/domains/task-records.ts); [task follow-up](../lib/openclaw/domains/task-follow-up.ts) | native + degraded | Continue only from an exact native session key/ID; never promote a synthetic dispatch ID to lineage authority. |
| Worktrees and isolated execution | B | OpenClaw `worktrees.*` plus native session creation and cleanup. | [C94 native work](evidence/openclaw-2026.9.4-native-work-hardening.json); [native work model](openclaw-native-work-model.md); [work model](../lib/openclaw/domains/native-work-model.ts) | native + degraded | Keep isolated mode explicit and fail closed when native capability or repository evidence is missing. |
| Execution environments | B | OpenClaw `environments.list/status/create/destroy` and the exact environment records. | [C94 native work](evidence/openclaw-2026.9.4-native-work-hardening.json); [environment contract test](../tests/openclaw-environment-preparation.test.ts); [topology service](../lib/openclaw/application/execution-topology-service.ts) | native + degraded | Use live capability and eligibility facts; do not infer an environment from provider identity or a failed request. |
| Session placement and handoff | B | OpenClaw session placement, generation, environment, and owner-epoch fields. | [C94 native work](evidence/openclaw-2026.9.4-native-work-hardening.json); [topology tests](../tests/openclaw-execution-topology.test.ts); [placement decision](openclaw-2026.9.1-native-execution-topology-placement.md) | native + degraded | Project unknown placement honestly and reconcile one transition; do not add a local placement owner. |
| Memory and memory actions | B | OpenClaw native memory search/status/dream-diary methods and native memory state. | [C94 native memory](evidence/openclaw-2026.9.4-native-memory.json); [memory service](../lib/openclaw/application/native-memory-service.ts); [memory operations](openclaw-native-memory-operations.md) | native + degraded | Keep unavailable, unknown, and error distinct; no AgentOS memory index or CLI substitute for native memory. |
| Plugins and runtime skills | B | OpenClaw plugin/skill identity, inventory, activation, install/update semantics, and effective runtime capability. | [C94 skills/capabilities](evidence/openclaw-2026.9.4-skills-effective-capabilities.json); [catalog service](../lib/openclaw/application/catalog-service.ts); [skills decision](openclaw-skills-and-effective-capabilities.md) | native + degraded | Continue native discovery and honest capability states; keep static catalogs as fallback metadata only. |
| Unified plugin catalog/workspace UX | D | Native 9.4 exposes additive catalog/control-UI contracts, but AgentOS has not productized a bounded operator surface for them. | [C94 audit disposition](openclaw-2026.9.4-compatibility-audit.md); [capability matrix](../lib/openclaw/application/capability-matrix-service.ts); [architecture lock](../tests/openclaw-architecture-lock.test.ts) | unsupported | Define a narrow operator outcome and re-audit the exact native contract before adding UI; do not create a parallel plugin workspace. |
| Updates, holds, and updater recovery | B | OpenClaw `update.status/run/hold`, Gateway restart coordination, native supervisor, and rollback. | [C94 Doctor/recovery](evidence/openclaw-2026.9.4-doctor-update-recovery.json); [C94 hardening](evidence/openclaw-2026.9.4-doctor-update-recovery-hardening.json); [update policy](../lib/openclaw/application/normal-update-policy-service.ts) | native + fallback + degraded | Keep live update mutation skipped in local certification unless separately authorized; project status and recovery without claiming completion. |
| Tasks and task control | B | OpenClaw `tasks.list/get/cancel` and native task status; AgentOS task cards are projections. | [C94 session/task](evidence/openclaw-2026.9.4-session-task-alignment.json); [task control](../lib/openclaw/application/task-control-service.ts); [task history contract](../tests/openclaw-task-history.test.ts) | native + degraded | Preserve native task identity/status and exact cancellation; keep projection-only rows labeled as such. |
| Task assignment and richer task history | D | `tasks.assign` is unsupported in the exact 2026.9.4 contract; `tasks.history` is a native additive contract but not productized here. | [C94 contract diff](evidence/openclaw-2026.9.3-to-2026.9.4-contract-diff.json); [C94 task evidence](evidence/openclaw-2026.9.4-session-task-alignment.json); [fail-closed client](../lib/openclaw/client/native-ws-gateway-client.ts) | unsupported | Do not synthesize assignment or history state. Revisit only with a bounded native contract and operator use case. |
| Sessions, transcripts, and continuation | B | OpenClaw session APIs, transcript/history, exact session identity, and session model/placement state. | [C94 session/task](evidence/openclaw-2026.9.4-session-task-alignment.json); [session model service](../lib/openclaw/application/session-model-service.ts); [Gateway client](../lib/openclaw/client/gateway-client.ts) | native + fallback + degraded | Keep transcript/history fallback as response recovery only; never silently switch to a default session. |
| Channels, accounts, and routing | B | OpenClaw channel/account credentials, auth/link state, lifecycle, status, and native routing/config. | [C94 channels in audit](openclaw-2026.9.4-compatibility-audit.md); [channel service](../lib/openclaw/application/channel-service.ts); [channel setup](../lib/openclaw/application/workspace-channel-setup-service.ts); [channel decision](openclaw-channels-accounts.md) | native + fallback + degraded | Use native status/lifecycle first; keep provisioning/QR/route fallbacks observable and never claim external login from configuration alone. |
| Auth, identity, profiles, and scopes | B | OpenClaw Gateway identity, role/scopes, device auth, model auth profiles, and channel auth. AgentOS product identity is distinct. | [C94 identity](evidence/openclaw-2026.9.4-identity-authorization.json); [security bootstrap](../lib/openclaw/application/gateway-security-bootstrap-service.ts); [model auth](../lib/openclaw/application/model-auth-service.ts) | native + fallback + degraded | Preserve native authorization as final; expose missing-scope/redacted-credential states without logging or storing secrets. |
| Persistence, schema, and migration | B | OpenClaw config/state/SQLite/schema migration and native Doctor; AgentOS may hold separate sidecars and projections. | [C94 runtime persistence](evidence/openclaw-2026.9.4-runtime-certification.json); [C94 migration](evidence/openclaw-2026.9.3-to-2026.9.4-migration.json); [migration service](../lib/openclaw/application/openclaw-migration-service.ts) | native + fallback | Delegate schema/migration ownership to OpenClaw and keep AgentOS sidecars separate; never introduce a competing migration journal. |
| Human control, diagnostics, and operator UX | C | Live OpenClaw facts plus AgentOS-normalized diagnostics, capability states, approvals/questions, recovery text, and audit metadata. | [C94 Human Control](evidence/openclaw-2026.9.4-human-control-inbox.json); [inbox service](../lib/openclaw/application/human-control-inbox-service.ts); [mission control](../lib/openclaw/application/mission-control-service.ts) | native + degraded | Keep scope, current state, next action, failure detail, and recovery visible; retain unknown/unavailable instead of optimistic empty states. |
| Parallel AgentOS runtime/registry/update authority | E | OpenClaw native runtime, task/session/worktree/skill/plugin state, persistence, schema, and updater remain authoritative. | [C94 architecture review](openclaw-2026.9.4-compatibility-audit.md); [sync audit](openclaw-sync-audit.md); [architecture lock](../tests/openclaw-architecture-lock.test.ts) | unsupported | Reject new local retry workers, runtime ledgers, task assignment stores, skill engines, plugin workspaces, worktree registries, schema engines, or update authorities. |

## Decision rule for future work

Start with the exact supported OpenClaw contract and the live Gateway capability
handshake. If OpenClaw owns the behavior, add only a typed adapter/client path
or a visible CLI fallback where no stable native path exists. If AgentOS owns
intent, policy, sidecar metadata, or operator presentation, keep that state
separate and label it. If the path is missing or uncertain, record `D` or a
degraded/unknown state and stop before inventing runtime behavior.

This matrix does not change historical evidence, GitHub issue state, external
accounts, credentials, tags, releases, deployments, or production state.

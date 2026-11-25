# AgentOS 0.10.0 engineering verification

This report records the first iteration. [Current integration and certification status](phase-ii.md)

The engineering branch is `codex/agentos-0.10.0-native-alignment`. The final application code is at `570b93aaac66fdc3b7485228fa797b580815b775`, and the complete test suite ran at `7787b5da1cb4bd5570e41c38c6cf814c8b3d3c2c`. The branch has no remote CI run. The installed-customer recommendation, published package metadata, desktop distribution and checked-in Railway runtime pin retain the existing 0.9.0 distribution and OpenClaw 2026.11.5 policy. The disposable tests below qualify specific scenarios on candidate OpenClaw 2026.11.10. [Initial audit and main CI](audit.md), [evidence and per-probe revisions](evidence.json)

## Phase status

| Phase | Status | Work delivered |
| --- | --- | --- |
| 0. Audit | Completed for this iteration | Compared supported, candidate and sampled main contracts, mapped ownership and reproduced the CI freshness failure. |
| 1. Runtime alignment | Partial | Qualified exact runtime packages, candidate SDK pair and local Linux arm64 image. Production pins await final certification. |
| 2. Chat and sessions | Partial | Continuing native conversations, scoped catalog and history, event invalidation and abort shipped on the engineering branch. Queue, steering, archive/reset and broader acceptance remain open. |
| 3. Login and models | Partial | Preserved OpenAI readiness guards and verified disposable model authorization and inference. Live account and entitlement acceptance remains open. |
| 4. Workspace, agents and memory | Partial | Validated representative state migration, workforce flows and native memory retrieval. Remote workspace/template and shared knowledge acceptance remains open. |
| 5. Channels, plugins, skills and MCP | Partial | Fixed native Skills Library activation and checked effective tools. Real channel and MCP lifecycle and plugin installation remain open. |
| 6. Operations, security and recovery | Partial | Native cron, human control, scoped chat authorization and archive rollback covered in disposable fixtures. Shared identity and remote policies need wider validation. |
| 7. Performance and simplification | Partial | Measured direct-chat improvements and fixed snapshot refresh races. Dashboard, scale and resource targets remain unmeasured. |
| 8. Synchronization and certification | Partial | Verified native interoperability, browser updates and isolated runtime, image and desktop package checks. Final release certification remains open. |

## Architecture and migration

The direct-chat route resolves the current AgentOS actor on the server and reads the native agent and its workspace. It derives a default key from the actor, agent and native workspace, with a scoped namespace for explicitly requested alternate conversations. The OpenClaw store defines the runtime boundary. AgentOS sends the operator’s current message, reasoning choice when supplied, and scoped idempotency ID. OpenClaw owns physical session IDs, transcripts, queuing, execution, history, runtime authorization and context management. Mission dispatch remains a separate workflow.

The drawer uses the existing composer and status feed. It lists recent alternate conversations through the native catalog, rehydrates from `chat.history`, receives scoped invalidation signals through `sessions.messages.subscribe` and sends a native abort for the admitted run. It reconciles history on connection establishment, subscription gaps, returning to the tab and turn completion. Session messages and native terminal events drive invalidation. The browser holds only drafts and a disposable projection. A failed history read is surfaced alongside the visible conversation.

AgentOS removed prompt reconstruction, per-turn session creation, local transcript polling, local session-store write checks in direct chat, and response substitutions that supplied an assistant answer from local metadata. Failure messages distinguish an admitted run from an unconfirmed delivery. A native stop has its own terminal stream event and user feedback. Gateway repair no longer resends a chat message. Direct chat no longer changes agent model assignments or writes provider auth order during send. The existing readiness guard for an implicit or OpenAI default and the version-scoped GPT-6.2 Sol guard remain. Explicit rename still requires both product agent-management permission and a separate native preflight. Assistant text alone no longer applies an AgentOS rename.

Existing fragmented sessions remain in the OpenClaw history. The new drawer opens a continuing session in its own namespace. Older conversations can be inspected through the OpenClaw session catalog. No historical turn is replayed, imported into model context, deleted, reassigned, or silently merged. Authenticated product accounts each receive a new default key on migration. The audit found no basis for retroactively assigning unscoped legacy history to individual product actors.

The snapshot controller now fences overlapping loads by generation. If a newer load is already in flight, an invalidated read joins it. Otherwise, it can return its result without publishing stale cache state. This keeps reads bounded during repeated invalidation. Skills Library activation accepts OpenClaw's persisted four-field selection receipt, while list rows retain catalog enrichment. Successful activation invalidates the native read cache before the application rereads the catalog.

### Recovery

The migration harness creates and verifies a native pre-upgrade backup while the disposable source Gateway is stopped. It upgrades SQLite state with native Doctor, connects the new Gateway, reads preserved representative agents, sessions, history, provider configuration, channel configuration, cron, skill and memory markers, and runs Doctor again. It stages the backup with the source binary and an empty bootstrap context, moves the migrated fixture assets aside, activates restored state/config/workspace paths offline, and boots the source runtime to verify the earlier schemas and transcript. The restored fixture used OpenClaw 2026.11.5, state schema 36 and agent schema 38 after upgrade to 40 and 42.

Keep verified archives outside the state tree. Restore into a fresh sibling staging location and activate only while the Gateway is stopped. Keep the post-upgrade tree available for recovery. Real WhatsApp ratchet state, provider refresh grants, third-party plugin dependencies and Postgres-backed installations require their own acceptance. [OpenClaw restore documentation](https://docs.openclaw.ai/install/backups)

## Evidence and scope

| Check | Result | Evidence and limits |
| --- | --- | --- |
| Repository build, lint, type checking and tests | PASS | 2,268 tests passed. The final production build passed in a clean checkout. An earlier workspace build reported 30 Turbopack file-tracing warnings. The separate release gates below apply. |
| Release consistency | PASS | Existing 0.9.0 package and installer metadata. |
| Candidate macOS clean runtime installation | PASS | Exact npm runtime, authenticated Gateway protocol 4, startup, persistence, Doctor and 59 successful runtime probes. The run also observed 13 expected denials and recorded 13 skips. |
| Candidate Gateway SDK pair | PASS | Isolated worktree with official Gateway client and protocol 2026.11.10. Type checking and exact-runtime native chat fixture passed. |
| Candidate Linux arm64 Railway image | PASS | Local image built with the 2026.11.10 SDK pair and official pinned 2026.11.10 runtime. A disposable container started the actual entrypoint, returned healthy HTTP and native Gateway responses, and reported the exact OpenClaw version. |
| macOS desktop package checks | PASS | A fresh worktree prepared the current 0.9.0 standalone package and passed the desktop shell checks using host Node 24.22.1. Packaged GUI launch and Windows remain unverified. |
| Certification freshness and production release gates | FAIL | Historical final artifact certifies `6520429582bf753f984520ef3e570017cda0ca0f`. Changes since then require recertification. |
| Exact 2026.11.5 and 2026.11.10 native session/task fixture | PASS | 50 streamed turns in one native session, 51 after client recreation, distinct conversation and actor scope, native catalog lookup, zero extra provider requests on duplicate ID, and native abort. The existing harness also restarts the Gateway and continues the mission fixture. The browser harness exposed a timeout while it overlapped submissions before waiting for a prior terminal response. The sequential Chrome retry passed. Concurrent direct chat remains open. |
| Chrome direct chat against exact 2026.11.10 | PASS | Opened the drawer, completed a streamed turn, received an external submission via native invalidation, reopened after page refresh, switched conversation, and stopped an admitted reply with confirmation and no failure toast. The composer stayed within the viewport after a 390 × 844 resize. Independent browser restart and physical mobile remain unverified. |
| HTTP boundary against exact 2026.11.10 | PASS | Unauthenticated GET, POST and PATCH returned 401. Authenticated send, history, separate conversations and same-session recovery across an AgentOS process restart passed. |
| Memory retrieval against exact 2026.11.10 | PASS | A persisted fact was retrieved, withheld from a different agent's workspace and retrieved after Gateway restart. The loopback embedding provider supplied deterministic vectors. |
| Verified archive and source rollback | PASS | macOS disposable source and target runtimes and native staged restore, as described above. |
| Native cron against exact 2026.11.10 | PASS | Existing automation suite with a loopback model provider. |
| Native Skills Library and effective tools | PASS | Native save, list, exact revision, attach, detach, cleanup, tool catalog and session-effective tools. Read-only activation returned the expected denial. Actual model use of an attached skill remains unverified. |
| Workforce application fixture | PASS | 14 checks passed and 5 were skipped. The first run reached the candidate before model metadata preparation finished. A bounded native, agent-scoped readiness read let the retry complete. Delegation, waiting worker, product-path human control, cancellation and child failure remain explicit skips. |
| Native human control against exact 2026.11.10 | PASS | Questions and exec approval create/read/resolve. Question event observed. Approval event coverage explicitly skipped by the suite. |
| Real ChatGPT login, model entitlement and inference | BLOCKED | Requires authorized test accounts, grant lifecycle exercises and real model responses. Fixture inferences establish transport and continuity. |
| Live channel and MCP account lifecycle | BLOCKED | Requires provider accounts and isolated channel/MCP fixtures with explicit authorization. |
| Context compaction, mid-stream reconnect, queue steering, archive/reset and cross-user projections | NOT_VERIFIED | Dispatcher and history contracts are covered. These operations need focused application-level acceptance on the candidate. |
| Windows and physical mobile | NOT_VERIFIED | No actual Windows host or mobile-device run for this branch. |
| Migration of customer-owned state | NOT_VERIFIED | Disposable representative data only. |

## Performance

The benchmark runs the prior fragmented dispatch strategy and the new continuing strategy on the same host, exact OpenClaw package and loopback provider. The fragmented strategy reads up to five previous native histories, builds the previous wrapper and creates an explicit per-turn session. It reuses the repository's historical prompt function only inside the benchmark. The new strategy sends the current unwrapped operator message to its stable key. Dispatch timing ends at Gateway admission and excludes actual model execution, HTTP/browser rendering and the old route’s filesystem polling. To reproduce, run `pnpm openclaw:session-task-e2e` with `OPENCLAW_DIRECT_CHAT_MATRIX=1`, `OPENCLAW_DIRECT_CHAT_BENCHMARK=1`, and the exact candidate package path, certification target identity and output path documented by the harness. [Session/task fixture](../../scripts/openclaw-session-task-e2e.ts), [candidate package identity](evidence.json)

The reference host was a macOS arm64 Mac17,8 with 48 GiB RAM and Node 24.22.1. Each arm submitted 50 turns. The final run without a parallel build or test suite measured 47.2 → 31.4 ms p95. Two runs during parallel validation measured 85.6 → 155.0 ms and 122.5 → 38.0 ms. Earlier passes measured 50.2 → 25.7 ms, 63.9 → 39.9 ms and 119.5 → 108.9 ms. The RPC and byte reductions were consistent. Admission latency varied with the run, and the benchmark did not isolate the sources of that variation.

| Metric | Fragmented | Continuing |
| --- | ---: | ---: |
| Native history reads before submission, 50 turns | 235 | 0 |
| Explicit session creation before submission, 50 turns | 50 | 0 |
| p95 submitted message size | 1,932 bytes | 27 bytes |
| Scheduled transcript reads during a send | One cycle every 250 ms while active | No periodic cycle |
| Scheduled browser history refresh while active and idle | One cycle every five seconds | Native invalidation and recovery triggers |

The byte count covers the submitted message string before native context handling. Provider input tokens remain unmeasured. Warm and cold dashboard latency, event-to-render p95, CPU, memory growth, and 50-agent/500-session browser scalability remain unmeasured. The chat API shrank from 1,265 to 882 lines. The engineering branch retains its existing dependency set.

## Before and after scorecard

Scores describe the evidence available for the engineering branch. A score of 5 means partial integration with material unverified behavior, 7 means exact-runtime coverage with unresolved acceptance gaps, and 10 requires the full stated acceptance matrix.

| Area | Before | After | Basis |
| --- | ---: | ---: | --- |
| Gateway-first architecture | 7 | 8 | Official transport already in place. Direct chat uses native session, history and event paths. |
| Upstream compatibility | 6 | 7 | Candidate descriptor diff and targeted exact-runtime interoperability. Full certification pending. |
| Workspace | 6 | 6 | Provisioning and representative state-preservation checks. Remote multi-agent acceptance pending. |
| Agents | 7 | 7 | Native roster used by direct chat. Full external edit/delete convergence unverified. |
| Chat | 4 | 7 | Native 50-turn continuity, scoped history and abort proven with fixture. Steering and attachments remain open. |
| Sessions | 5 | 7 | No per-turn split. Distinct compositions, stable history and restart acceptance. |
| Memory | 5 | 7 | Positive persisted retrieval and separate agent scope verified with loopback embeddings. |
| Knowledge | 5 | 5 | Native inputs and product freshness exist. Shared/private policy and cross-client acceptance pending. |
| Models | 6 | 6 | Exact fixture inference. Real model entitlement, harness and per-session reasoning acceptance pending. |
| Providers | 6 | 6 | Existing owner and scoped readiness retained. Real provider matrix pending. |
| ChatGPT login | 5 | 5 | Existing connection flow kept. No new live evidence. |
| Channels | 6 | 6 | Configuration preserved. Real routing, QR and disconnect pending. |
| Plugins | 6 | 6 | Public SDK entry inspected. Candidate install/enable/recovery matrix pending. |
| Skills | 5 | 7 | Corrected activation receipt and stale reads. Native revision validation added. |
| MCP | 3 | 3 | Native contract inventoried. Unified product experience and real auth validation pending. |
| Automations | 6 | 7 | Native cron execution proof against exact candidate. |
| Security | 6 | 7 | Scoped direct-chat routing, explicit authorization and unauthorized route tests. Shared native service identity remains an acceptance boundary. |
| Runtime recovery | 5 | 7 | Verified backup, upgrade and old runtime boot from restored fixture. |
| Synchronization | 5 | 6 | Targeted native chat events and restart continuation. Broader bidirectional parity pending. |
| Performance | 5 | 7 | Direct-chat RPC and byte reductions measured. Dashboard and high-load targets remain open. |
| Code quality | 6 | 7 | Reduced chat route responsibility, removed transport-derived local heuristics and fenced snapshot concurrency. |
| Release readiness | 3 | 4 | Stronger runtime evidence with production freshness and platform gates open. |

## Release decisions

| Decision | Status | Reason |
| --- | --- | --- |
| Engineering completion | NO-GO | Scoped direct chat, skills and recovery work landed. The full phase and acceptance list remains incomplete. |
| Native runtime alignment | NO-GO | Candidate compatibility is established for the targeted fixtures. The complete feature, account and upgrade matrix remains open. |
| Existing user migration | NO-GO | Disposable SQLite rollback passed. Real provider/channel credentials, production state variants and platform migrations still need acceptance. |
| Local release readiness | NO-GO | Exact final release certification and live provider acceptance remain missing. |
| Desktop release readiness | NO-GO | A clean rebuild passed the 0.9.0 shell checks after the original workspace reported stale generated metadata. Candidate packaged GUI and Windows acceptance remain open. |
| Railway release readiness | NO-GO | Local Linux arm64 build and boot passed. Hosted storage recovery, deployment and target-platform acceptance remain open. |
| Public production release readiness | NO-GO | Freshness and production gates remain closed. |

## Next release blockers

1. Run authorized real ChatGPT login, account lifecycle and inference, plus real cloud/local provider routes. Validate OpenClaw principal mapping and end-to-end member isolation for every read and mutation surface.
2. Complete native direct-chat queue, steering, interrupted-run recovery, context compaction, attachments and archive/reset testing. Keep actions tied to verified native contracts for both supported releases.
3. Qualify the candidate SDK and distribution pins, candidate plugin packaging, pristine install and representative migration across macOS, Linux, Windows and Railway. Generate the current final certification artifact against the actual release code HEAD.
4. Verify workspace provisioning and shared/private knowledge, channels, plugins, skills and MCP through native clients in both directions. Measure dashboard and reconnect behavior with representative load.

## Changed files

| File | Change |
| --- | --- |
| `app/api/agents/[agentId]/chat/route.ts` | Scopes history, catalog, event invalidation, send and stop to the authorized native conversation. |
| `components/mission-control/agent-chat-drawer.tsx` | Adds conversation selection and native stop, refreshes history from invalidations and presents degraded reads. |
| `components/mission-control/agent-chat-runner.ts` | Tracks admission and streaming by conversation, preserves submission correlation and removes synthetic reply substitution. |
| `components/mission-control/agent-chat-storage.ts` | Retains a bounded display window and distinguishes user and assistant records with the same submission reference. |
| `lib/openclaw/client/cli-gateway-client.ts` | Rejects history and streaming requests marked as native-only. |
| `lib/openclaw/client/native-ws-gateway-client.ts` | Uses native history, admits direct-stream callbacks and correlates native run and session events. |
| `lib/openclaw/client/native-ws-gateway-mappers.ts` | Maps native abort events to cancellation even when they carry no assistant text. |
| `lib/openclaw/client/native-ws-gateway-payloads.ts` | Validates persisted Skills Library selections and enriched list rows using their respective contracts. |
| `lib/openclaw/client/native-ws-gateway-policy.ts` | Classifies skill activation as a mutation so reads invalidate after acknowledgment. |
| `lib/openclaw/client/types.ts` | Exposes typed admission/tool callbacks and the public Skills Library receipt selection type. |
| `lib/openclaw/domains/agent-chat-sessions.ts` | Derives direct-chat keys and transport idempotency IDs without rewriting legacy records. |
| `lib/openclaw/state/snapshot-cache.ts` | Prevents stale refreshes from replacing or clearing the latest generation. |
| `scripts/lib/openclaw-sdk-versions.ts` | Reads actual installed SDK versions for certification evidence. |
| `scripts/openclaw-fresh-baseline-e2e.ts` | Records installed SDK identifiers independently of the runtime under test. |
| `scripts/openclaw-human-control-certification.ts` | Uses observed SDK identifiers in human-control evidence. |
| `scripts/openclaw-migration-release-e2e.ts` | Adds staged archive activation and source-runtime verification in disposable state. |
| `scripts/openclaw-multi-user-collaboration-certification.ts` | Uses observed SDK identifiers in collaboration evidence. |
| `scripts/openclaw-native-doctor-certification.ts` | Uses observed SDK identifiers in Doctor evidence. |
| `scripts/openclaw-native-memory-certification.ts` | Verifies positive retrieval, different agent scope and persistence after restart. |
| `scripts/openclaw-runtime-provider-fixture.ts` | Responds to fixture embedding requests for the native memory test. |
| `scripts/openclaw-session-task-e2e.ts` | Exercises 50 turns, deduplication, separate threads, native abort and the dispatch benchmark. |
| `scripts/openclaw-skills-effective-capabilities-certification.ts` | Uses valid skill metadata and records which activation behavior the suite actually observed. |
| `scripts/openclaw-workforce-acceptance.ts` | Waits for native model metadata readiness before the disposable workforce run. |
| `tests/agent-chat-sessions.test.ts` | Covers stable scope and idempotency isolation. |
| `tests/mission-control-refactor.test.ts` | Checks native chat ownership and activity consumer contracts. |
| `tests/openclaw-native-ws-gateway-client.test.ts` | Covers the minimal activation receipt and a fresh post-activation read. |
| `tests/openclaw-snapshot-cache.test.ts` | Reproduces overlapping refreshes and checks latest-generation convergence. |
| `docs/native-runtime-alignment/audit.md` | Records the capability and ownership audit and upstream differences. |
| `docs/native-runtime-alignment/verification.md` | Records architecture, migration, benchmarks, scorecard and release decisions. |
| `docs/native-runtime-alignment/evidence.json` | Summarizes bounded runtime, build and verification results with provenance. |

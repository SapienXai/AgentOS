# AgentOS 0.10.0 integration and certification

This iteration continues at `ade6b4704d2ccd348f17d8473c8a07e05422d5ff` on `codex/agentos-0.10.0-native-alignment`. The meaningful code revision is `3d57c8e0f9fe82bda97b3a31a36288cb30ef7234`. Product browser and chat evidence used `29fd64fb53a96e65325df61d872fe12689137e30`. The next change reads imported upstream descriptor policy constants for contract evidence. AgentOS distribution metadata is `0.10.0`. The candidate runtime, official Gateway client and protocol, fresh install target, Railway image, and plugin build metadata are `2026.11.10`. The compatibility floor and normal update recommendation remain `2026.11.5`. The repository's stable-version requirement applies to candidate artifacts built with its existing release process. [Intake and ownership audit](audit.md) · [Previous iteration](verification.md) · [Draft validation PR](https://github.com/SapienXai/AgentOS/pull/49)

## Phase status

| Phase | Implemented and observed | Remaining |
| --- | --- | --- |
| 1. Native chat and sessions | Each clicked or keyboard-confirmed send has its own submission ID and native follow-up admission. OpenClaw holds and orders queued work. Chrome exercised same-tab overlaps and separate browser contexts. An exact-runtime SDK test confirmed the queued receipt, distinct IDs, native history order and two provider executions. Native terminal acknowledgments without text reconcile against history. Stop and Send remain independently available, and the history watcher stays connected during local sends. | Queue inspection, editing, dismissal and steering controls are incomplete. Reset/archive, attachments, pagination, compaction, reconnect during an active queued run and separate physical devices need acceptance. Existing keys include the workspace path. Agent/workspace relocation still needs a verified native continuity strategy. |
| 2. Principal isolation | Shared-credential direct chat is restricted to authenticated instance owners, desktop operators and trusted service callers. GET history, catalog and SSE require native read identity. SSE sends bounded invalidation hints, rechecks product authorization before emitting, and preserves a pending hint for slow subscribers. Protected HTTP owner, member, revocation and service-history partition tests passed. | Product owners and privileged services operate inside one trust boundary. Native collaboration fixtures passed separately. Product sign-in still lacks a per-user Gateway credential mapping across all surfaces. Task, memory, capability, provider, file and approval projections still need a complete role-by-resource matrix. Use separate Gateway instances and credentials for separate trust boundaries. [OpenClaw trust model](https://docs.openclaw.ai/gateway/security) |
| 3. ChatGPT and providers | Inspected the candidate's Luna fix and the existing version-scoped GPT-6.2 Sol guard. Disposable model inference and readiness passed. | Real ChatGPT grant, reuse, switching, refresh, logout and entitlement acceptance require authorized accounts. Real cloud and local inference remain open. Existing recovery and compatibility logic still applies where configured. [OpenClaw 2026.11.10 changelog](https://github.com/openclaw/openclaw/blob/v2026.11.10/CHANGELOG/2026.11.10.md) |
| 4. Workspaces, memory and workforce | Managed workspace file reads and writes reject a configured remote Gateway before resolving host paths. File reads now require workspace-management permission. Native cold repository inspection waits for the scoped branch-change event and rereads once. The exact-runtime worktree, suggestion, membership and handoff fixture passed. Native memory retrieval and disposable migration/rollback passed. Workforce passed 14 checks and skipped five. | Remote file operations, workspace relocation and ClawHub provisioning are incomplete. Authorized shared knowledge, additional compaction cases and native bidirectional updates need acceptance. Workforce delegation, waiting worker, product human control, cancellation and child failure remain skipped. |
| 5. Channels, plugins, skills and MCP | The plugin builds and its six package tests pass against the candidate SDK. The PR's ClawHub package dry run passed. Native skills attach/detach and effective capabilities passed with expected scope denial. | Live Telegram, Discord, Slack and WhatsApp accounts and messaging are unverified. Plugin lifecycle and actual model use of an attached skill remain open. Unified MCP configuration, health, sign-in and sign-out are unimplemented. Candidate `mcp.authLogout` requires admin and targets the native operator connection. [Native logout handler](https://github.com/openclaw/openclaw/blob/v2026.11.10/src/gateway/server-methods/mcp-auth-logout.ts) |
| 6. Performance and synchronization | The deterministic event-bridge regression now holds an old in-flight snapshot through invalidation and proves it cannot refill the cache or displace a fresh read. Payload caches stay scoped to the load generation. Cold worktree branch lookup makes at most one extra read, triggered by the native event or a bounded timeout. | Dashboard incremental projections, 50 agents and 500 sessions, sustained concurrency, event-to-render timing and CPU/memory targets are unmeasured. |
| 7. Runtime and distribution | Actual package, tarball, signed-tag and pinned image identities were checked. Frozen install, CLI/desktop shell checks, local macOS arm64 bundle, Linux arm64 Railway build and disposable session persistence through container recreation passed. Same-container restart failed, and the packaged macOS window and embedded server launched with the Gateway intentionally unreachable. A representative SQLite archive restored the source runtime and prior transcript. | Signed desktop distribution, physical macOS Intel, Linux x64 and Windows x64 product runtime runs, physical mobile, hosted Railway persistence and broader customer-state migration are open. |
| 8. Certification | Targeted runtime, browser, migration and authorization checks ran in isolated fixtures. Draft CI passed stable and beta compatibility. The quality job failed at certification freshness and the dependent browser smoke was skipped. | The isolated evaluator accepted all 18 staged artifact assessments after the descriptor parser fix. Those artifacts include mixed code revisions. The final certification invocation failed without a bound evidence commit. Freshness and production validation failed because the branch has no accepted candidate certification artifact. Full bidirectional product acceptance and bound evidence are still required. |

## Quality and runtime evidence

The repository passed lint, type generation, type checking, 2,271 tests, a clean production build, and package release consistency. Independent exact-runtime checks covered identity, native collaboration, lifecycle, official Gateway lifecycle and disposable transport cutover, fresh boot with 59 passes and 13 expected denials, native memory and skills, worktrees, cron, questions and approvals, and native Doctor. Upstream package intake verified package identity and still reported certification as blocked. Real provider/channel tests and native mutation scenarios explicitly skipped by the harnesses remain open. [Evidence, revisions and scope](evidence.json)

The verified upgrade ran OpenClaw 2026.11.5 → 2026.11.10 with state schema 36 → 40 and agent schema 38 → 42. Offline restore and source boot returned to the earlier schemas and recovered the representative transcript. There is no PostgreSQL migration evidence in this iteration.

## Performance and simplification

With 50 turns per arm on exact OpenClaw 2026.11.10, p95 Gateway admission was 64.6 → 37.4 ms without another task-managed workload and 53.5 → 38.6 ms with two low-priority Node CPU workers. This isolated CPU pressure did not reproduce the earlier contention regression. Its cause remains undetermined. The benchmark times the native adapter through Gateway admission.

The continuing conversation removes the previous 235 history pre-reads and 50 session creation requests over 50 turns. The p95 submitted message size remains 27 bytes versus 1,932 bytes for the fragmented strategy. No background execution queue, transcript store or dependency was added. The composer keeps only local in-flight presentation state and uses native lifecycle receipts and history after a turn. The event bridge prevents obsolete payload results from refilling cached state.

On macOS arm64, Node 24.22.1, Chrome and a loopback provider, a one-agent disposable fixture produced a 199,195-byte authenticated snapshot. On the product revision, forced refresh (5 samples) measured median 2,258.6 ms and p95 2,339.1 ms. Warm reads (15 samples) measured median 6.0 ms and p95 10.9 ms. These HTTP measurements include transfer and local application/Gateway work. Dashboard DOM paint, production provider time and resource load remain unmeasured.

## Scorecard changes

| Area | Iteration I | Iteration II | Evidence |
| --- | ---: | ---: | --- |
| Gateway-first architecture | 8 | 8 | The Gateway owns follow-up ordering and worktree readiness. |
| Upstream compatibility | 7 | 8 | Checked-in SDK and runtime pair, stable and beta CI compatibility. |
| Workspace | 6 | 7 | Native worktree readiness and managed file locality guard. |
| Agents | 7 | 7 | Protected operator paths and agent scope. External lifecycle parity remains open. |
| Chat | 7 | 8 | Same-tab and peer-context overlap plus native receipts and run IDs. |
| Sessions | 7 | 7 | Scoped continuation and ordering. Relocation and lifecycle controls remain open. |
| Memory | 7 | 7 | Reran native persistence and isolation. Compaction and real embedding acceptance remain open. |
| Knowledge | 5 | 5 | Shared/private content checks remain open. |
| Models | 6 | 6 | Disposable inference and native readiness. Real entitlement is unverified. |
| Providers | 6 | 6 | Disposable inference reran. Live account lifecycle remains open. |
| ChatGPT login | 5 | 5 | Candidate change inspected. Live grant and model acceptance remain open. |
| Channels | 6 | 6 | Live end-to-end delivery remains open. |
| Plugins | 6 | 6 | Candidate builds and dry run passed. Install/update/recovery are open. |
| Skills | 7 | 7 | Exact native attach/detach reran. Actual model use remains unverified. |
| MCP | 3 | 3 | Native lifecycle inspected. Unified product management is missing. |
| Automations | 7 | 7 | Native cron disposable acceptance passed again. |
| Security | 7 | 7 | Direct-chat and file denial are verified. Broader principal isolation remains open. |
| Runtime recovery | 7 | 8 | Representative rollback and candidate container volume recreation passed. |
| Synchronization | 6 | 7 | Browser peer convergence, event invalidation, and scoped worktree refresh passed. |
| Performance | 7 | 7 | Direct chat and HTTP snapshot timings measured. Dashboard and load targets remain open. |
| Code quality | 7 | 7 | Removed in-flight send coalescing and cache refills from invalidated loads. |
| Release readiness | 4 | 4 | Exact candidate setup passed selected probes. Final release gates remain closed. |

## Owner acceptance

1. Supply an isolated AgentOS/OpenClaw environment and authorize interactive ChatGPT sign-in for two test identities. Exercise an entitled model response, reuse and switching, refresh after restart, revocation, disconnect and reconnect. Provide a disposable cloud API-key profile and an isolated native local model endpoint for the same inference checks.
2. Provide disposable Telegram, Discord, Slack and WhatsApp destinations and authorize two-way direct and group test messages. Include a test phone for WhatsApp QR pairing and one isolated OAuth MCP server for login, restart and logout. Use native accounts and confirm agent bindings from both clients.
3. Provide staging access with a representative sanitized workspace and pre-upgrade archive. Verify one local and one remote workspace, two native principals with distinct permissions, hosted volume restart/restore, and the capability and isolation matrix before operator rollout.
4. Provide physical macOS Intel, Linux x64, Windows x64 and iOS/Android targets for install, startup, upgrade and rollback acceptance. Supply authorized signing and notarization access for distribution validation when publication is separately approved.

## Release decision

| Decision | Status | Reason |
| --- | --- | --- |
| Engineering completion | NO-GO | Native chat lifecycle, workspace templates and MCP management are incomplete. |
| Native runtime alignment | NO-GO | Candidate interoperability passed targeted checks. Full principal isolation, provider entitlement and bidirectional product acceptance remain open. |
| Existing-user migration | NO-GO | The disposable archive was restored. Customer credential and state variants remain unverified. |
| Local release | NO-GO | The code revision has no passing final candidate certification. |
| Desktop release | NO-GO | Local macOS arm64 bundle acceptance covers limited startup. Signed distribution and target platform runtime acceptance remain open. |
| Railway release | NO-GO | The isolated container recreated from its volume. Same-container restart failed and hosted acceptance remains open. |
| Public production release | NO-GO | Candidate evidence has not passed final certification, certification freshness or production validation. |

The branch and draft are engineering artifacts. No merge, package publication or production deployment was performed.

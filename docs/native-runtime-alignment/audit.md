# AgentOS 0.10.0 native runtime alignment audit

Audit date: 2026-11-25. AgentOS started at `d992fdded9b00aba91248dd1c030a53b4a5ea6c4`, which matched `origin/main`. The [baseline CI run](https://github.com/SapienXai/AgentOS/actions/runs/45568460481) failed certification freshness. Its stable and beta compatibility jobs passed. The gate still requires evidence bound to the code under test.

| Reference | Runtime source commit | Runtime / package facts |
| --- | --- | --- |
| Current production policy | `e13cf15ece9bbd969b7362927c315362c90c97ff` | OpenClaw 2026.11.5, schema 36 / agent schema 38, Gateway client and protocol packages 2026.11.5 |
| Candidate stable and npm latest | `6ea542fd97e2876aa4c871ccc494ed5419a03c5c` | OpenClaw 2026.11.10, schema 40 / agent schema 42, Gateway client and protocol packages 2026.11.10 available |
| OpenClaw main sampled during intake | `ba96ee582ad6ca2a45458616890e0a083569786c` | Source comparison only |

The candidate runtime and prior runtime were installed from the public npm registry into disposable directories. The AgentOS checkout kept its 2026.11.5 SDK pins. Runtime evidence obtained with these SDKs represents that exact interoperability combination. The npm distribution, desktop package and Railway image require independent qualification before promotion.

Primary sources: [2026.11.10 release](https://github.com/openclaw/openclaw/releases/tag/v2026.11.10), [candidate descriptors](https://github.com/openclaw/openclaw/blob/v2026.11.10/src/gateway/methods/core-descriptors.ts), [baseline descriptors](https://github.com/openclaw/openclaw/blob/v2026.11.5/src/gateway/methods/core-descriptors.ts), [main descriptors](https://github.com/openclaw/openclaw/blob/ba96ee582ad6ca2a45458616890e0a083569786c/src/gateway/methods/core-descriptors.ts), [candidate protocol](https://github.com/openclaw/openclaw/tree/v2026.11.10/packages/gateway-protocol), [candidate Gateway client](https://github.com/openclaw/openclaw/tree/v2026.11.10/packages/gateway-client).

## Capability and ownership matrix

Classifications describe AgentOS integration. Runtime evidence is limited to the scenarios listed in the [verification report](verification.md). P0 items block promotion. P1 items govern operational completeness. P2 items are capability additions.

| Capability | Starting classification | Owning contract and AgentOS surface | Evidence or acceptance criterion |
| --- | --- | --- | --- |
| Gateway | NATIVE_ALIGNED | OpenClaw hello, role, scopes and events. AgentOS official Gateway transport and coordinator. | P0. Verify exact SDK and runtime pairing, handshakes, scope denials and reconnect on each distribution. |
| Config | PARTIAL_NATIVE | OpenClaw `config.get`, `config.schema.lookup`, `config.patch`. Native adapter also carries local compatibility and repair. | P1. Migration fixture reads and preserves config. Validate import, remote writes, stale-hash rejection and recovery separately. |
| Workspaces | PARTIAL_NATIVE | AgentOS owns organization and project composition. OpenClaw owns agent workspace files, execution and sandbox policy. `workspace-service.ts`, `workspace-provisioning-service.ts`, `workspace-file-service.ts`. | P1. Prove multi-agent project parity and access isolation with remote native file operations. |
| Agents | PARTIAL_NATIVE | OpenClaw `agents.list/create/update/delete`. AgentOS writes workforce roles and composes provisioning. | P1. Isolated migration creates and preserves agents. Verify edit/delete and bidirectional UI convergence. |
| Chat | DUPLICATED | OpenClaw `chat.send/history`, `sessions.messages.subscribe`, `chat` events and `sessions.abort`. AgentOS drawer formerly created a session for each send and injected transcripts. | P0. Persistent direct conversation, event-driven history and scoped native stop implemented. Verify release matrix and recovery. |
| Sessions | PARTIAL_NATIVE | OpenClaw catalog, physical IDs, lifecycle, and ACLs. AgentOS selects bounded product conversations and separately projects mission context. | P0. Continuing and explicit new conversations verified at Gateway. Native reset/archive, queued input actions and compaction acceptance remain separate. |
| Memory | PARTIAL_NATIVE | OpenClaw `memory.search/status/get`, `doctor.memory.*`. AgentOS native memory service presents outcomes. | P1. Require a seeded fact, different agent scope and post-restart retrieval. Empty RPC results are a transport observation. |
| Context engines | PARTIAL_NATIVE | OpenClaw plugin and memory context policies. AgentOS inspector presents configuration and outcomes. | P1. Verify compaction, provenance and context behavior on the exact target. |
| Knowledge | PARTIAL_NATIVE | AgentOS owns project ingestion intent, freshness and composition. OpenClaw owns consumed files and retrieval. `workspace-native-knowledge-service.ts`. | P1. Verify shared workspace reading and private facts stay private through native access policies. |
| Models | PARTIAL_NATIVE | OpenClaw catalog, active model and session override. AgentOS `model-management-service.ts`, `session-model-service.ts`. | P1. Verify an executable effective model and reasoning route with live entitlement. |
| Providers | PARTIAL_NATIVE | OpenClaw `models.authStatus/authLogin/authLogout/authRefresh`, inference. AgentOS provider settings and fixture mapping. | P0. Verify real cloud and local inference, failures, expiry and per-runtime auth. |
| Authentication | PARTIAL_NATIVE | AgentOS authenticates the product actor. OpenClaw Gateway authenticates its native identity and remains final authorization authority. | P0. Verify actor-to-native principal mapping and all shared projections, including member isolation. |
| ChatGPT sign-in | PARTIAL_NATIVE | OpenClaw sign-in grant and provider credentials. AgentOS `siwc-onboarding-service.ts` and `chatgpt-provider-auth-service.ts` present and coordinate setup. | P0. Validate live authorized login, staged grant retry, refresh, account changes and actual inference before removing version guards. |
| Channels | PARTIAL_NATIVE | OpenClaw plugin descriptors, account readiness, bindings and channel routing. AgentOS channel service and setup UI. | P1. Migration preserved fixture config. Provision and route through an authorized real account. |
| Accounts | PARTIAL_NATIVE | OpenClaw native channel/model account lifecycles. AgentOS maintains operator-facing inventory and setup status. | P1. Verify readiness, revoke and reconnect across native clients. |
| Plugins | PARTIAL_NATIVE | OpenClaw catalog, install/enable/ready/effective contracts. AgentOS `agentos-browser-policy` imports the public plugin-entry SDK. | P1. Candidate lifecycle and desktop plugin packaging need separate acceptance. |
| Skills | PARTIAL_NATIVE | OpenClaw `skills.status/search/detail/install/update`. AgentOS policy skills are workspace-authored metadata. | P1. Migration preserves a workspace skill marker. Verify install/update and agent-scoped effectiveness. |
| MCP | MISSING | OpenClaw `mcp.authLogin`, candidate `mcp.authLogout`, `mcp.app.*` and config reload. AgentOS exposes some effective capability data. | P1. Build unified native-backed server setup, account lifecycle and health after testing exact authorization and reload. |
| Tasks | NATIVE_ALIGNED | OpenClaw `tasks.list/get/cancel` and session lineage. AgentOS projects mission intent and references. | P1. Session/task fixture checked native admission, continuation and distinct task semantics. Verify external edits and real job state convergence. |
| Subagents | PARTIAL_NATIVE | OpenClaw owns delegation and task ancestry. AgentOS workflow/mission projection. | P1. Test live delegation and recovering parent/child lineage across restart. |
| Automations | PARTIAL_NATIVE | OpenClaw `cron.*`, due schedules, retries and run state. AgentOS operator controls. | P1. Migration preserved a fixture cron row. Prove due execution and external edits on candidate. |
| Approvals | PARTIAL_NATIVE | OpenClaw exec approvals and policy. AgentOS native mutations and human-control service. | P0. Verify read/write scopes, missing presence, expiry and native acknowledgment. |
| Human control | PARTIAL_NATIVE | OpenClaw questions, approvals and browser handoff. AgentOS coordinates the operator inbox. | P1. Verify external resolutions and handoff recovery. |
| Browser runtime | PARTIAL_NATIVE | OpenClaw browser runtime. AgentOS thin plugin and product policy/live session controls. | P0. Verify live handoff and every protected API boundary in local and remote deployments. |
| Worktrees | PARTIAL_NATIVE | OpenClaw `worktrees.*` and session ownership. AgentOS inspectors and workspace composition. | P1. Verify conflict and lossless cleanup with native tools. |
| Execution environments | PARTIAL_NATIVE | OpenClaw native environment and placement APIs. AgentOS placement UI and policies. | P1. Verify remote placement, inaccessible files and reclaim without local assumptions. |
| Nodes and devices | PARTIAL_NATIVE | OpenClaw node inventory and device pairing. AgentOS native adapter and setup UI. | P1. Candidate `device.pair.code` needs authenticated pairing verification. |
| OpenClaw ID | MISSING | Candidate exposes `openclawId.account/authority/people/status`. These names differ on sampled main. | P2. Confirm stable use case, methods and ownership before adding product controls. |
| Updates | PARTIAL_NATIVE | OpenClaw `update.status` and native update lifecycle. AgentOS lifecycle policy and rollout UI. | P0. Exact shipped runtime and image must pass the production update/recovery gate. |
| Doctor | PARTIAL_NATIVE | OpenClaw owns diagnosis, safe changes and migration. AgentOS presents and invokes native operations and explicit recovery. | P0. Disposable Doctor migration and repeated recovery ran. Platform and deployment recovery remain open. |
| Backup and recovery | PARTIAL_NATIVE | OpenClaw `backup create --verify`, staged `backup restore` and offline activation. | P0. Verify exact pre-upgrade restoration, compatible boot, provider profiles and data, plus media/channel recovery. |

## Contract changes that affect the milestone

- The baseline's core descriptor tuples list 497 operator methods. Candidate tuples list 503, with 15 additions and nine removals. This is a source inventory of matching descriptor declarations. Aliases, plugin methods, advertised runtime capabilities and effective scopes require runtime corroboration.
- Candidate additions include `chat.steerNow`, `mcp.authLogout`, `device.pair.code`, `sessions.catalog.resolve`, session group creation and file previews. Candidate removals include `projects.searchRemote` and legacy `skills.workshop.*` operations. No AgentOS caller for those retired method names was found in the application boundary scan.
- Candidate Control UI steers a **queued input** with a native session key, physical session ID and run ID. It refreshes the pending input view after acknowledgment. The baseline has a different steering surface and sampled main lacks the candidate descriptor. AgentOS retains its generic session steering boundary pending version-specific queue acceptance. [Control UI pending-input controller](https://github.com/openclaw/openclaw/blob/v2026.11.10/ui/src/pages/chat/chat-pending-inputs.runtime.ts)
- `chat.send` supports an explicit session key and a caller idempotency key. Candidate implementation admits new sessions natively and assigns a native physical ID. `chat.history` can load a bounded history for that key. Scope continues to be enforced on the connected native identity. [Send handler](https://github.com/openclaw/openclaw/blob/v2026.11.10/src/gateway/server-methods/chat-send-session.ts), [history handler](https://github.com/openclaw/openclaw/blob/v2026.11.10/src/gateway/server-methods/chat-history-handler.ts)
- ClawHub provisioning belongs to `templates.catalog.*` and `templates.add.plan/apply`. The app should compose these through its existing workspace creation boundary after verified trust, provisioning and clean recovery. [Candidate changelog](https://github.com/openclaw/openclaw/blob/v2026.11.10/CHANGELOG/2026.11.10.md)
- New workspace model and auth contracts do not establish subscription entitlement. Existing version-scoped ChatGPT/GPT-6.2 Sol protections stay in place until a real authorized model response verifies changed behavior. [Official provider model probes](https://github.com/openclaw/openclaw/blob/v2026.11.10/src/gateway/server-methods/models-probe.ts)

## Implementation order

1. Keep production version policy and certification intact while gathering exact-runtime evidence.
2. Align direct chat with native history and session continuity, then verify it at the Gateway and HTTP/browser boundaries.
3. Exercise native backup, migration, rollback and first-party memory retrieval on disposable state.
4. Close environment-limited acceptance items and complete candidate SDK, release distribution and platform qualification before changing the recommended runtime.

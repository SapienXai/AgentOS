# AgentOS OpenClaw 2026.9.4 Compatibility Audit

Certification date: 2026-09-12  
Status: locally certified compatibility target; no publish, deploy, tag, or
production infrastructure change was performed.

## Executive result

AgentOS 0.7.9 promotes OpenClaw 2026.9.4 as its recommended and native
contract version. The exact upstream package, signed tag identity, Gateway
protocol, schema migration, official transport, lifecycle, security, and
subsystem certification gates passed in disposable local runtimes.

The supported minimum remains OpenClaw 2026.9.1. A newer recommended version
does not remove older supported installations. The Railway deployment remains
explicitly pinned to OpenClaw 2026.9.3 because this task was local-only and did
not authorize production infrastructure mutation.

## Exact upstream identity

The audit compares the exact annotated release tags `v2026.9.3` and
`v2026.9.4`, not upstream `main`:

| Field | 2026.9.3 source | 2026.9.4 target |
| --- | --- | --- |
| Tag | `v2026.9.3` | `v2026.9.4` |
| Signed tag object | `a69d657b4b74556017f2d0ef98b0c64aeabb3643` | `8bec206f3c1f787e1e9c45cfd34d3de2a78c7b8e` |
| Peeled source commit | `1391f7cd2d40ab5bbcf2f5f831d3a64f520e72d7` | `3a9d69db306cd7f081e06254cb89c4bcc14a7107` |
| Build identity | `2026.9.3-release-1391f7cd2d40-2026-09-08T07-46-00.264Z` | `2026.9.4-release-3a9d69db306c-2026-09-10T22-53-16.719Z` |
| Gateway protocol | v4 | v4 |
| State schema | 16 | 17 |
| Agent schema | 19 | 19 |
| Node engine | `>=24.16.0 <25 \|\| >=26.1.0` | `>=24.16.0 <25 \|\| >=26.1.0` |

The exact target package identity was read from `dist/build-info.json` and
the package metadata. The target OpenClaw package hash used by the runtime
evidence is:

`2863452d8d2c2d302c3462af3f90e41b401708efdcbbbf81d723e73dd8ac67cf`

The npm tarball integrity values verified by the contract audit are:

- `openclaw@2026.9.4`: `sha512-lTQpEEe1Xm3u2PCHaPEr+vP8paGk1vLdHuzdItsNToaLI6hAqRVvgJYg+GxukJhETJp4tPy/S1Gftl4KuB8n7A==`
- `@openclaw/gateway-client@2026.9.4`: `sha512-MQSj/agWzPMvPbWIyh5azarYYJvxcrc9TVdPn22zdGAfW7SAOpocpa/ImOi8YcIDk6IILXvv0nRDFKXQnjMS6A==`
- `@openclaw/gateway-protocol@2026.9.4`: `sha512-arnDRQV4d7yP1veI0i3UWJSrRk7ehgM0N8n0kQoVc0yP6/cy40GZmshh10RD/ZASrhGeZGDXbVQBjSHIHgrtDg==`

## Upstream contract audit

The official protocol schema remains v4 with the same minimum client, node,
and probe protocol values. The exact schema inventory changed additively:

- Gateway methods: 440 → 445; no methods were removed.
- Definitions: 950 → 965; no definitions were removed.
- Added methods: `environments.prepare`, `plugins.catalog.browse`,
  `plugins.catalog.categories`, `plugins.catalog.get`, and `tasks.history`.
- Changed method descriptors: canvas document view, environment listing, and
  plugin Control UI list/reload/report/status.
- Changed data contracts include agent-file optimistic hashes, model/provider
  detail and refresh outcomes, plugin components/catalog facts, question URLs,
  session placement state, session auto-labels, task transcript presence, and
  worker profile metadata.

The machine-readable comparison is
[`openclaw-2026.9.3-to-2026.9.4-contract-diff.json`](evidence/openclaw-2026.9.3-to-2026.9.4-contract-diff.json).
It verifies the exact package archives, source tag identity, protocol v4,
schema 16 → 17, agent schema 19, and additive method/definition evolution.

Important semantic changes found in the exact 9.4 source include:

| Change | Classification | AgentOS decision |
| --- | --- | --- |
| State schema 16 → 17, including prepared-worker/session placement state | Migration/security-relevant | Exercise the native Doctor/runtime migration; do not own the schema or placement state. |
| Verified backups and native updater recovery/rollback semantics | Migration/lifecycle/security-relevant | Preserve native `update.status`/`update.run`/supervisor authority and project failed-after-rollback honestly. |
| Service handoff and restart behavior for 9.2/9.3-origin updates | Behavioral/lifecycle-relevant | Validate through disposable native lifecycle evidence; keep AgentOS process control bounded to its existing supervisor boundary. |
| Provider/model identity, fallback, context, thinking, tool, and vision fixes | Behavioral/AgentOS-relevant | Consume native responses and capabilities; do not create a model or fallback engine. |
| Conversation history, reconnect, and task history reliability | Behavioral/AgentOS-relevant | Re-certify existing session/task projections; defer a new task-history UI. |
| Plugin convergence/catalog and plugin SDK changes | Additive/future-facing | Keep native plugin inventory and install/update semantics; do not build a parallel Plugins workspace. |
| `OPENCLAW_CONFIG_READONLY=1` | Security/ownership-relevant | Document as an option for externally managed environments; do not enable it globally because AgentOS must preserve native ownership semantics per deployment. |
| Memory and Gateway responsiveness changes | Behavioral/AgentOS-relevant | Re-certify native availability/error states; do not fabricate readiness or add a polling runtime. |

## AgentOS changes

The migration made the smallest changes needed to align the existing
Gateway-first architecture:

- Pinned `@openclaw/gateway-client` and `@openclaw/gateway-protocol` to
  `2026.9.4` together and regenerated `pnpm-lock.yaml`.
- Added an exact candidate target helper so 9.4 could be certified before
  promotion without making the old 9.3 historical scripts mutable.
- Updated the promoted recommended/native identity to the verified 9.4
  source commit, build ID, protocol, state schema, and agent schema.
- Updated the AgentOS browser-policy plugin metadata to the 9.4 plugin SDK.
- Adjusted the Doctor certification path to OpenClaw 9.4's real CLI rule:
  repair uses `doctor --fix --non-interactive`; JSON reporting remains
  read-only and cannot be combined with `--fix`.
- Added exact-source contract audit, disposable 9.3 → 9.4 migration,
  final-certification aggregation, and semantic regression tests.
- Updated active compatibility documentation and prepared the canonical
  published package at version 0.7.9. The private root package remains 0.1.0
  as required by the existing release architecture.

No AgentOS runtime, lifecycle state machine, updater ledger, schema migration
engine, model registry, plugin workspace, channel runtime, memory index, or
OpenClaw replacement was added.

## Disposable migration result

The migration harness created isolated temporary HOME, config, state,
workspace, package, and Gateway process directories. It initialized and
exercised a real OpenClaw 2026.9.3 runtime through the official Gateway,
including agents, parent/child sessions, transcript data, provider/auth-shaped
configuration, channel/account-shaped configuration, a skill, memory and
project markers, cron data, update status, and explicit AgentOS security
policy.

It then ran the real OpenClaw 2026.9.4 Doctor repair/startup path and reconnected
with the official client. The result was:

- source runtime identity: 2026.9.3, state schema 16;
- target runtime identity: 2026.9.4, source commit `3a9d69d…`, build ID above;
- state schema: 16 → 17, with agent schema 19 preserved;
- Gateway reconnect: passed over protocol v4;
- agents: 2 preserved; sessions: 2 preserved; assistant transcript messages: 1 preserved;
- model/provider-shaped config, channel config, skill, memory, project, and
  explicit AgentOS security policy: preserved;
- repeated Doctor/recovery check: idempotent;
- temporary process, ports, state, config, and directories: cleaned up;
- production Gateway/state/config mutation: false.

The migration evidence records `SKIPPED` for `channels.list` and
`memory.status` because the exact runtime returned an unknown-method response
for those optional probes. Native memory certification separately passed using
the methods actually advertised by the runtime. No external provider or
channel credential was accessed.

Evidence: [`openclaw-2026.9.3-to-2026.9.4-migration.json`](evidence/openclaw-2026.9.3-to-2026.9.4-migration.json).

## Certification matrix

| Area | Result | Evidence | Notes |
| --- | --- | --- | --- |
| Exact upstream identity and package integrity | PASS | [contract diff](evidence/openclaw-2026.9.3-to-2026.9.4-contract-diff.json) | Signed tag object, peeled commit, build, protocol, schemas, and archive integrity verified. |
| Fresh 9.4 baseline | PASS | [fresh baseline](evidence/openclaw-2026.9.4-fresh-baseline.json) | Exact 9.4 package in a disposable fresh runtime. |
| 9.3 → 9.4 schema migration | PASS | [migration](evidence/openclaw-2026.9.3-to-2026.9.4-migration.json) | Native Doctor/runtime path; no production state touched. |
| Gateway transport, HelloOk, protocol v4, reconnect, streaming | PASS | [official transport](evidence/openclaw-2026.9.4-official-transport-certification.json), [runtime](evidence/openclaw-2026.9.4-runtime-certification.json) | Official client/protocol; expected scope denial remained denied. |
| Start, stop, restart, recovery, service ownership | PASS | [lifecycle](evidence/openclaw-2026.9.4-lifecycle-certification.json), [official lifecycle](evidence/openclaw-2026.9.4-official-gateway-lifecycle-certification.json) | Disposable native supervisor/process paths. |
| Identity, users, scopes, dynamic authorization | PASS | [identity](evidence/openclaw-2026.9.4-identity-authorization.json) | Missing-scope and forbidden outcomes are represented honestly. |
| Shared Gateway and multi-user participation | PASS | [multi-user](evidence/openclaw-2026.9.4-multi-user.json), [collaboration](evidence/openclaw-2026.9.4-multi-user-identity-collaboration.json) | Actor attribution and ownership boundaries preserved. |
| Sessions, tasks, lineage, history, interrupted recovery | PASS | [session/task](evidence/openclaw-2026.9.4-session-task-alignment.json), [workforce](evidence/openclaw-2026.9.4-workforce-acceptance.json) | Native task/session identity remains authoritative. Five optional workforce observations were skipped. |
| Models, providers, credentials, fallback, capabilities | PASS | [official runtime](evidence/openclaw-2026.9.4-final-official-runtime-certification.json), [runtime](evidence/openclaw-2026.9.4-runtime-certification.json) | No real credentials accessed; unsupported settings are not fabricated. |
| Channels and accounts | PASS | [official runtime](evidence/openclaw-2026.9.4-final-official-runtime-certification.json), [migration](evidence/openclaw-2026.9.3-to-2026.9.4-migration.json) | Account representation and status semantics were checked; live external auth was not claimed. |
| Skills, plugins, capability truthfulness | PASS | [skills](evidence/openclaw-2026.9.4-skills-effective-capabilities.json), [migration](evidence/openclaw-2026.9.3-to-2026.9.4-migration.json) | Native inventory/install semantics retained; no plugin workspace UI added. |
| Native memory | PASS | [memory](evidence/openclaw-2026.9.4-native-memory.json) | Readiness and unavailable/error states remain native and honest. |
| Automation and cron | PASS | [automation](evidence/openclaw-2026.9.4-automation-cron-alignment.json) | Jobs, status, trigger, delivery, and cancellation paths exercised. |
| Human Control approvals/questions | PASS | [Human Control](evidence/openclaw-2026.9.4-human-control-inbox.json) | Native authorization and required user action remain authoritative. |
| Doctor diagnostics, repair, idempotency | PASS | [Doctor](evidence/openclaw-2026.9.4-doctor-update-recovery.json), [hardening](evidence/openclaw-2026.9.4-doctor-update-recovery-hardening.json) | 9.4 repair/reporting mode distinction verified. |
| Native updater/recovery representation | PASS | [official runtime](evidence/openclaw-2026.9.4-final-official-runtime-certification.json), [hardening](evidence/openclaw-2026.9.4-doctor-update-recovery-hardening.json) | Rollback/recovery remains OpenClaw-owned; failed-after-rollback is not success. |
| Native work and project/session ownership | PASS | [native work](evidence/openclaw-2026.9.4-native-work-hardening.json) | OpenClaw owns worktrees, placement, task and collaboration state. |
| Final promotion gate | PASS | [final certification](evidence/openclaw-2026.9.4-final-certification.json) | 20 artifact gates passed; 0 failed and 0 environment-limited required gates. |

The final aggregation contains 92 explicit optional `SKIPPED` observations and
67 expected authorization denials across the certification artifacts. These
are not converted into passes; no required gate is environment-limited, and no
production Gateway or real credential was used.

## New 9.4 capability disposition

| Capability | Disposition |
| --- | --- |
| Protocol/client additive changes, reconnect/history/provider fixes, native updater/recovery | Automatically inherited where existing AgentOS projections consume native facts; independently recertified. |
| Doctor repair mode and exact 9.4 identity | AgentOS adapter/certification alignment required and implemented. |
| Plugin catalog and unified plugin management | Useful future AgentOS UI exposure; deliberately deferred. Existing native inventory and browser-policy compatibility remain covered. |
| Prepared cloud sessions/workers and placement details | Useful future workspace/session UX; deliberately deferred. OpenClaw remains authoritative. |
| `tasks.history`, terminal question URLs, delegated Talk completion | Future adapter/UI opportunities; not productized in a compatibility release. |
| `OPENCLAW_CONFIG_READONLY=1` | Documented for externally managed environments; not enabled globally until deployment ownership semantics are proven. |
| New upstream product workspace surfaces | Deliberately deferred and irrelevant to this compatibility scope. |

## Architecture and security review

The upgrade did not introduce duplicate OpenClaw functionality, a custom
lifecycle state machine, a custom update authority or rollback ledger, legacy
compatibility hacks, or an unnecessary abstraction. OpenClaw remains the
authority for Gateway runtime, lifecycle, config, sessions, tasks, agents,
models/providers, auth and identity, channels, skills/plugins, memory, cron,
Human Control, Doctor, updater, persistence, and schema migration. AgentOS
continues to provide operator policy, normalized projections, diagnostics,
security preflight, and bounded process supervision where native Gateway
self-control is unavailable.

Security-sensitive defaults and ownership boundaries were preserved. The
certification harness used disposable directories and loopback processes,
redacted evidence, no real credentials, and explicit cleanup checks.

## Version decision and limitations

- AgentOS published package: `0.7.9`.
- Recommended OpenClaw: `2026.9.4`.
- Native contract OpenClaw: `2026.9.4`.
- Supported baseline OpenClaw: `2026.9.1`.
- Official client/protocol: `2026.9.4` / `2026.9.4`.
- Production deployment: intentionally unchanged; Railway remains on 9.3.
- New product UI/features: intentionally not added.

The local 9.4 result certifies the AgentOS code and exact disposable runtime.
It does not certify a live third-party provider, channel login, hosted
deployment, or production rollout. Those require separate authorization and
environment-specific validation.


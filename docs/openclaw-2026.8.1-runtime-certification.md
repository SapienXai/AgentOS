# OpenClaw 2026.8.1 Runtime Certification

> Historical 2026.8.1 artifact. The active runtime certification is [OpenClaw 2026.8.2](evidence/openclaw-2026.8.2-runtime-certification.json); see [the current model/provider architecture](openclaw-2026.8.2-model-provider-architecture.md).

Certification date: 2026-08-31

This document records the historical Phase 2A.1 hardening run against an isolated OpenClaw `2026.8.1` Gateway. The active AgentOS recommended and supported baseline is now `2026.8.2`; this run still did not mutate production configuration or production SQLite state.

## Provenance

- Repository: AgentOS
- Branch: `upgrade/openclaw-2026.8.1`
- Starting local and remote HEAD: `878d6bb029d6225352344d2da2e25be88660fd5c`
- AgentOS root version: `0.1.0`
- AgentOS package version: `0.7.6`
- `OPENCLAW_RECOMMENDED_VERSION`: `2026.8.1`
- `OPENCLAW_SUPPORTED_BASELINE_VERSION`: `2026.8.1`
- OpenClaw target version: `2026.8.1`
- Exact OpenClaw target source commit: `ea806575e6450e4d1efdfc72c19f04be982a1b9b`
- OpenClaw build ID: `2026.8.1-ea806575e645-2026-08-31T00-16-08.235Z`
- Host: macOS `26.5.2`, Darwin arm64
- Node: `v24.15.0`
- pnpm: `10.30.3`

The working tree was clean before implementation. The real run used the exact target package in a disposable runtime root, a separate state directory, and loopback WebSocket port `28789`. The existing developer Gateway on port `18789` was not controlled.

## Isolated Runtime

The isolated Gateway reported OpenClaw `2026.8.1 (ea80657)`, protocol `4`, authenticated role `operator`, `371` advertised methods, and `55` advertised events. The native AgentOS WebSocket client performed the probes through `NativeWsOpenClawGatewayClient.callNative`; no CLI fallback was used as evidence for native behavior.

Model execution used a deterministic loopback OpenAI-compatible HTTP fixture:

- provider: `agentos-fixture`
- model: `agentos-runtime-fixture`
- model reference: `agentos-fixture/agentos-runtime-fixture`
- external credentials required: no
- external credentials used: no

The fixture returned synthetic responses only and did not log request bodies.

## Evidence Model

Runtime evidence is now multi-dimensional. The dimensions are `availability`, `authorization`, `positiveExecution`, `responseShape`, and `lifecycle`; each dimension is explicitly `proven`, `failed`, `not-required`, or `not-tested`.

Each operation also has a requirement level: `required`, `optional`, or `experimental`. The outcome is one of `certified`, `partially-certified`, `failed`, `uncertified`, or `static-only`.

An expected authorization denial proves only the authorization dimension. A successful method call with a validated payload proves availability, positive execution, and response shape; lifecycle is added only when the probe observes the relevant state transition. Optional and experimental gaps do not block the core migration gate.

## Previous Evidence Bug

The previous bridge treated `EXPECTED-DENIAL` as equivalent to a successful functional probe. That could fully certify a method such as `node.invoke` when the only runtime proof was a read-only denial and no paired node existed.

The new harness records denial proof as `authorization=proven` while leaving `positiveExecution` and `responseShape` as `not-tested`. The evidence aggregator and static-to-runtime bridge require every operation-specific mandatory dimension before returning `certified`. A skipped or failed positive probe remains visible and cannot be promoted by a negative authorization result.

## Core Model Execution

The run created a disposable `dev` session, sent a synthetic first prompt through native `chat.send`, observed a completed model turn from the loopback fixture, and read the resulting `chat.history`. The result was `PASS`; the expected synthetic assistant response was present and history contained one assistant message.

This was a real provider-backed OpenClaw agent turn, not method advertisement or request acceptance. The committed artifact contains only booleans, counts, categories, and synthetic identifiers; it does not contain the prompt or response body.

## Streaming

The native client subscribed to the session event stream before sending the turn. The fixture emitted multiple SSE content chunks followed by a completion event. The harness verified:

- at least two normalized text frames;
- session association;
- a terminal completed status;
- successful AgentOS event normalization;
- a persisted assistant response after completion.

The `chat.streaming` operation was `certified`. No unexpected 2026.6 event-shape assumption was used.

## Restart Continuity

The real sequence passed:

`first model turn → gateway.restart.request → reconnect and fresh handshake → same session history → second model turn`

The first synthetic assistant response remained in history after restart, the second response completed successfully, and the resulting history contained two assistant messages. The stable session identity remained addressable through the same session key. The report also recorded healthy shared SQLite integrity and healthy `openclaw doctor --json` output.

## Cron Execution

A disposable enabled isolated `agentTurn` cron job was added with a one-hour interval, updated, explicitly run, and removed. The run used the same deterministic loopback model fixture and returned a successful terminal entry from `cron.runs`. The harness accepts the OpenClaw 2026.8.1 `entries` history shape and correlates the exact returned run ID.

`cron.run` was `PASS`, and the cron job was cleaned before the report was serialized.

## Remaining Runtime-Required Methods

The nine rows previously marked runtime-required by static analysis were audited individually:

| Method | Requirement | Positive proof | Authorization proof | Outcome | Reason |
| --- | --- | --- | --- | --- | --- |
| `channels.pairing.approve` | experimental | Not tested | Not tested | partially-certified | No pending external pairing request existed in the isolated runtime. |
| `fs.listDir` | optional | PASS with validated `/tmp` listing shape | Not required for this probe | certified | Safe host-directory probe completed against an isolated low-risk path. |
| `node.invoke.progress` | experimental | Not tested | Not tested | partially-certified | No physical node invocation existed from which to observe progress events. |
| `node.pluginTools.update` | experimental | Not tested | Not tested | partially-certified | No paired node was available. |
| `node.runnerInventory.update` | experimental | Not tested | Not tested | failed | The target Gateway did not advertise the method. |
| `node.skills.update` | experimental | Not tested | Not tested | partially-certified | No paired node was available. |
| `sessions.dispatch` | optional | Failed with `INVALID_REQUEST` because no paired session-host node was available | Not tested | failed | The method is available, but this environment cannot provide a safe positive worker/device target. |
| `sessions.move` | optional | Failed with `INVALID_REQUEST` because the disposable session was in local placement | Not tested | failed | No valid alternate Gateway placement was available. |
| `sessions.patchMany` | optional | PASS with validated `outcomes` response | Not required for this probe | certified | Safe disposable session batch patch completed. |

The node and pairing rows remain environment-dependent. They are not core AgentOS migration requirements because AgentOS does not currently depend on physical node delivery, Talk audio transport, or semantic memory search for baseline operation.

## Core Runtime Matrix

| Operation | Requirement | Availability | Authorization | Positive Execution | Shape | Lifecycle | Outcome |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `sessions.create` | required | proven | proven | proven | proven | proven | certified |
| `sessions.patch` | required | proven | proven | proven | proven | proven | certified |
| `sessions.delete` | required | proven | proven | proven | proven | proven | certified |
| `chat.send` | required | proven | proven | proven | proven | not-tested | certified |
| `chat.streaming` | required | proven | proven | proven | proven | not-tested | certified |
| `session.continuity` | required | proven | proven | proven | proven | proven | certified |
| `agents.create` | required | proven | proven | proven | proven | not-tested | certified |
| `agents.update` | required | proven | proven | proven | proven | not-tested | certified |
| `agents.delete` | required | proven | proven | proven | proven | not-tested | certified |
| `config.get` | required | proven | not-tested | proven | proven | not-tested | certified |
| `config.patch` | required | proven | proven | proven | proven | proven | certified |
| `gateway.restart` | required | proven | proven | proven | proven | proven | certified |

## Evidence Bridge

The static-to-runtime bridge matched exact target version, method/operation identity, requirement level, and dimension-bearing runtime proofs. It retained static unknowns and allowed runtime failures to override optimistic static evidence.

The final bridge summary was:

- certified: `19`
- partially-certified: `8`
- failed: `3`
- uncertified: `2`
- static-only: `199`

The static comparison source was historical `github-static`, from `2026.6.11` to `2026.8.1`, with `371` target methods, `0` blockers, `29` warnings, and `17` unknowns. The exact target source commit is retained in the committed artifact as `staticContract.targetCommit`.

## Migration Readiness

`READY FOR PHASE 2B`

The gate returned no blockers. It verified exact static/runtime target matching, installed version `2026.8.1`, supported protocol `4`, an authenticated operator with read/write scopes, healthy persistence, and certified required operations including model execution, streaming, restart, session continuity, config mutation, and agent/session lifecycle.

This gate is evidence-only and does not itself perform production automatic updating. Phase 2C uses it as supporting evidence for the direct `2026.8.1` fresh baseline.

## Sanitized Evidence Artifact

The committed artifact is:

`docs/evidence/openclaw-2026.8.1-runtime-certification.json`

It was generated by `scripts/openclaw-runtime-certification.ts` using `serializeOpenClawRuntimeCertificationArtifact`. It contains schema version `2`, provenance, every probe, requirement levels, dimension states, status, failure categories, bridge rows, and the readiness result. Credential/token/API-key fields, bearer values, and local paths are redacted. A post-run recursive secret scan returned `false`.

## Cleanup

The harness uses `try/finally` and records cleanup results. The final run reported `complete` for the disposable session, agent, question, cron job, workspace, and loopback provider endpoint. The Gateway process was owned by the outer isolated-run wrapper, which terminated it after certification; port `28789` was released. No production Gateway or user cron/session resource was touched.

## Tests

- Focused runtime certification, evidence bridge, readiness gate, and serializer tests: `18` passed.
- Real isolated runtime certification: `49 PASS`, `2 FAIL`, `10 SKIPPED`, `13 EXPECTED-DENIAL`, `0 UNKNOWN`; the two failures are the documented optional `sessions.dispatch` and `sessions.move` environment limits.
- Runtime persistence: SQLite `PRAGMA integrity_check` healthy; `openclaw doctor --json` healthy.

## Verification

The final real run used native WebSocket RPC and the isolated loopback provider. It did not use external provider credentials. The existing developer OpenClaw process remained outside the test scope. The artifact was generated by the harness in the repository; it was not hand-edited.

## Files Changed

- `lib/openclaw/runtime-certification/types.ts`
- `lib/openclaw/runtime-certification/harness.ts`
- `lib/openclaw/runtime-certification/evidence-model.ts`
- `lib/openclaw/runtime-certification/evidence-bridge.ts`
- `lib/openclaw/runtime-certification/readiness-gate.ts`
- `lib/openclaw/runtime-certification/serialization.ts`
- `scripts/openclaw-runtime-certification.ts`
- `scripts/openclaw-runtime-provider-fixture.ts`
- `tests/openclaw-runtime-certification.test.ts`
- `tests/openclaw-runtime-evidence-bridge.test.ts`
- `tests/openclaw-runtime-evidence-serialization.test.ts`
- `tests/openclaw-runtime-readiness-gate.test.ts`
- `docs/evidence/openclaw-2026.8.1-runtime-certification.json`
- `docs/openclaw-2026.8.1-runtime-certification.md`

## Claim / Evidence Matrix

| Claim | Code evidence | Runtime evidence | Test / limitation |
| --- | --- | --- | --- |
| Exact OpenClaw target is tested | Harness target/version and artifact target commit | Installed `2026.8.1`, build ID and protocol `4` | Isolated runtime only; no production upgrade |
| Authorization is not functional proof | Dimensioned harness and evidence aggregator | Denial proofs leave positive execution and shape unproven | Regression tests cover denial-only partial state |
| Core model execution works | Native `chat.send`, fixture, history polling | Completed synthetic assistant turn persisted | No external provider or tool-call claim |
| Native streaming works | Event subscription and AgentOS normalizer | Multiple chunks, completion, session match | Fixture stream; external provider stream variance remains |
| Restart continuity works | Restart probe and second-turn history check | First turn survived restart and second turn completed | Disposable local session only |
| Cron execution works | `cron.run` plus `cron.runs` exact run-ID poll | Successful fixture-backed terminal run | Disposable isolated cron job only |
| Low-risk static rows are classified honestly | Requirement levels and per-operation bridge | `fs.listDir`/`sessions.patchMany` passed; dispatch/move environment-failed | Node/pairing fixtures remain unavailable |
| Migration readiness is gated | Readiness evaluator | Gate returned `READY FOR PHASE 2B` with no blockers | This historical report is supporting evidence; the Phase 2C fresh gate records the active baseline decision |

## Deferred Findings

- Physical node delivery and node progress/plugin/inventory/skills updates need a disposable paired node and safe allowlist.
- Channel pairing approval needs a pending isolated pairing request fixture.
- Talk session/audio needs a configured audio provider and transport fixture.
- Semantic memory search needs an embedding-backed fixture.
- `sessions.dispatch` needs an available session-host node; `sessions.move` needs a valid non-local target placement.

## Known Risks

- The loopback fixture proves the OpenClaw/AgentOS execution path and response normalization, not compatibility with every external model provider or tool-call protocol variant.
- Optional and experimental failures remain visible in the artifact and must not be read as broad OpenClaw feature certification.
- The readiness gate remains a certification/reporting primitive until a later phase explicitly integrates migration-engine behavior.

## Commit

The hardening phase is committed separately with:

`test(openclaw): harden 2026.8.1 runtime certification`

The final commit and remote SHA are recorded in the task report after validation and push.

## Phase Verdict

`PHASE 2A.1 COMPLETE`

The core OpenClaw 2026.8.1 runtime contract is certified for migration-engine planning, with optional and experimental device/audio/memory/placement gaps explicitly retained as non-blocking findings.

# OpenClaw 2026.8.1 Compatibility Audit

Status: Phase 1 static compatibility foundation. This document records tag-pinned evidence and does not certify runtime compatibility.

## Provenance

- OpenClaw repository: `openclaw/openclaw`
- Current tag: `v2026.6.11` at `e085fa1a3ffd32d0ea6917e1e6fb4ecbffbb77d2`
- Target tag: `v2026.8.1` at `ea806575e6450e4d1efdfc72c19f04be982a1b9b`
- Descriptor source for both tags: `src/gateway/methods/core-descriptors.ts`
- [v2026.6.11 descriptor source](https://raw.githubusercontent.com/openclaw/openclaw/v2026.6.11/src/gateway/methods/core-descriptors.ts)
- [v2026.8.1 descriptor source](https://raw.githubusercontent.com/openclaw/openclaw/v2026.8.1/src/gateway/methods/core-descriptors.ts)
- [Pinned GitHub tag comparison](https://github.com/openclaw/openclaw/compare/v2026.6.11...v2026.8.1)
- AgentOS starting main HEAD: `ad8416910df411f194c0b60e1f8b45e91dcb2a7f`
- Phase 1 branch: `upgrade/openclaw-2026.8.1`
- The comparison uses the two exact release tags. `main` is not used as an OpenClaw comparison source.

## Baseline Constants

The existing AgentOS baseline constants are unchanged:

- `OPENCLAW_RECOMMENDED_VERSION = "2026.6.11"`
- `OPENCLAW_SUPPORTED_BASELINE_VERSION = "2026.6.8"`
- Current AgentOS package root version: `0.1.0`
- Published AgentOS package version: `0.7.6`

No OpenClaw runtime binary, session store, SQLite state, hosted deployment, or AgentOS release version was upgraded in Phase 1.

## Contract Analysis

The v2026.6.11 descriptor table uses legacy object rows. The v2026.8.1 table uses tuple rows with family, scope, since-tag, and optional policy metadata. The Phase 1 parser reads both layouts as bounded static text and never evaluates source code.

| Evidence | v2026.6.11 | v2026.8.1 |
| --- | ---: | ---: |
| Registered descriptor rows | 209 | 393 |
| Advertised methods | 190 | 371 |
| Hidden methods | 19 | 22 |
| `dynamic` methods | 1 | 12 |
| `operator.questions` methods | 0 | 5 |
| `operator.talk` methods | 0 | 14 |

Normalized descriptor diff:

- Added methods: 194
- Removed methods: 10
- Common methods: 199
- Scope changes: 18
- Policy changes: 8
- Replacements inferred from an existing AgentOS operation retaining a target candidate: 9
- Renames proven by the descriptor evidence: 0

Removed methods:

`doctor.memory.remHarness`, `node.pair.request`, `node.pair.verify`, `sessions.compaction.get`, `sessions.unsubscribe`, `talk.session.cancelTurn`, `talk.session.endTurn`, `talk.session.join`, `talk.session.startTurn`, and `voicewake.routing.set`.

The nine replacement classifications are operation-level evidence, not an assertion that OpenClaw declared a rename: memory doctor, node pairing, session subscriptions, Talk session control, and voice wake routing retain other candidate methods. `sessions.compaction.get` has no equivalent proven by the current AgentOS operation map.

Scope changes:

- `config.schema`: `operator.admin` to `operator.read`
- `talk.config`: `operator.read` to `dynamic`
- Ten Talk methods: `operator.write` to `operator.talk`
- `sessions.create`: `operator.write` to `dynamic`
- `sessions.patch` and `sessions.delete`: `operator.admin` to `dynamic`
- `node.invoke` and `agent`: `operator.write` to `dynamic`

Policy changes:

- Startup availability was added to `sessions.subscribe`, `agent`, and `chat.send`.
- Control-plane write policy was added to `cron.add`, `cron.update`, `cron.remove`, and `cron.run`.
- `gateway.restart.preflight` is marked `compatibilityRestored` in the target descriptor.

The exact tag comparison found 518 changed files under `src/gateway/server-methods/` and 211 changed files under `packages/gateway-protocol/`. No changed files were found under `src/gateway/protocol/` for this comparison. These are implementation/protocol evidence, not runtime proof.

## Implementation

- `lib/openclaw/application/update-contract-diff-service.ts` now parses legacy object descriptors and v8 tuple descriptors, including policy metadata and exact-tag scope names.
- The parser enforces source-size and row-count bounds, validates method names/scopes/since-tags, rejects malformed or duplicate rows, and fails closed without executing OpenClaw source.
- Static diff results now retain registered versus advertised counts and classify blocker, warning, safe, and unknown evidence.
- Required operation loss is the only static blocker condition. Optional or experimental loss remains warning evidence even when an operation disables CLI fallback.
- Scope transitions use explicit scope semantics. `dynamic` and `node` transitions are unknown until runtime authorization and payload behavior are verified; fixed dedicated-scope changes are warnings rather than numeric privilege escalation.
- GitHub compare file evidence is fetched by pinned tag comparison with bounded pagination and includes renamed file paths when supplied. If the upstream comparison exceeds that bound, the report emits unknown evidence instead of treating missing paths as unchanged.
- The compatibility matrix includes model authentication, session recovery, Gateway restart control, operator questions, execution approval grants, session viewers, current Talk methods, Talk client transcript/close, and voice-wake routing. Legacy candidates remain ordered after modern candidates where they are still needed for the baseline.

## Compatibility Matrix

AgentOS continues to prefer native Gateway methods through its existing client and adapter boundaries. CLI fallback remains explicit and operation-policy controlled; this phase does not make CLI fallback the default for a native operation.

Modern target surfaces mapped into the matrix include:

| AgentOS operation | Target methods or scopes | Baseline treatment |
| --- | --- | --- |
| Model authentication | `models.authLogout`, `operator.admin` | Experimental until runtime proof |
| Session recovery | `sessions.recover`, `sessions.reclaim`, `sessions.rewind` | Experimental until runtime proof |
| Session message stream | `sessions.subscribe`, `sessions.messages.subscribe`, `sessions.messages.unsubscribe`, `sessions.viewers.set` | Optional with legacy unsubscribe retained as a final candidate |
| Execution approvals | `exec.approval.grants.list`, `exec.approval.grants.revoke` | Optional |
| Operator questions | `question.request`, `question.waitAnswer`, `question.resolve`, `question.get`, `question.list`, `operator.questions` | Experimental until runtime proof |
| Talk session | `talk.session.acknowledgeMark` plus current session methods, `operator.talk` | Optional with old turn aliases retained for the old baseline |
| Talk client | `talk.client.transcript`, `talk.client.close`, `operator.talk` | Optional |
| Gateway restart | `gateway.restart.preflight`, `gateway.restart.request` | Experimental until runtime proof |

## Authorization Changes

The target source adds `operator.questions` and `operator.talk` to the closed operator-scope union. Target method authorization is not a simple numeric ladder:

- `operator.admin` authorizes all scopes.
- `operator.read` accepts read or write authorization.
- `operator.talk` accepts talk or write authorization.
- `operator.questions`, `operator.approvals`, and `operator.pairing` remain dedicated scopes.
- Dynamic methods derive authorization from request parameters and state; static descriptors cannot prove the resulting scope.

AgentOS applies these semantics in compatibility contract checks. Existing default operator scopes remain v6-compatible; the new scopes are not blindly added to the default connect or repair requests because v2026.6.11 does not recognize them.

## Tests

Focused tests cover:

- legacy object and v8 tuple parsing;
- policy metadata, dedicated scopes, dynamic scopes, malformed rows, duplicates, and fail-closed behavior;
- added, removed, replaced, required-loss, optional-loss, and implementation/protocol evidence;
- invalid release input with zero network calls;
- compatibility checks where write authorizes read/Talk and dedicated question scope remains exact.

## Verification

The implementation must be verified with the repository commands before this phase is considered complete:

```text
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

Phase 1 does not claim runtime compatibility. A real OpenClaw 2026.8.1 Gateway session, method payload probes, session continuity, node pairing, Talk turns, memory doctor, model auth, config, and automation verification remain deferred.

Validation recorded for this branch: the focused OpenClaw regression set passed 187 tests; `pnpm typecheck`, `pnpm lint`, and `pnpm build` passed. The existing local runtime compatibility command reported degraded status on OpenClaw v2026.6.11; it did not exercise v2026.8.1.

## Deferred Findings

- Runtime verification against an actual v2026.8.1 Gateway.
- Payload and error-shape checks for newly added methods.
- Dynamic authorization verification for sessions, nodes, agents, Talk configuration, and parameter-sensitive filesystem methods.
- Full session continuity and subscription behavior across update/restart.
- Node pairing, Talk turn lifecycle, memory doctor, model auth, config policy, and automation control-plane smoke tests.
- Review of the complete 194-method addition set beyond the mapped AgentOS surfaces.

## Known Risks

- The static evidence is authoritative only for the two pinned source tags and cannot prove runtime behavior.
- A GitHub compare endpoint failure produces bounded unknown evidence; it must not be read as compatibility certification.
- The target adds substantial Gateway surface area and protocol implementation churn; Phase 2 must run a real runtime matrix before any target is certified.

# OpenClaw 2026.8.1 Compatibility Audit

> Historical 2026.8.1 artifact. The active certified AgentOS baseline is OpenClaw 2026.8.2; see [the current model/provider architecture](openclaw-2026.8.2-model-provider-architecture.md).

Status: Historical Phase 1 static compatibility analysis retained for provenance. The active AgentOS baseline is the separately certified OpenClaw `2026.8.2` runtime; see [`docs/openclaw-2026.8.2-model-provider-architecture.md`](openclaw-2026.8.2-model-provider-architecture.md).

## Provenance

- OpenClaw repository: `openclaw/openclaw`
- Historical source tag: `v2026.6.11` at `e085fa1a3ffd32d0ea6917e1e6fb4ecbffbb77d2`
- Target tag: `v2026.8.1` at `ea806575e6450e4d1efdfc72c19f04be982a1b9b`
- Descriptor source for both tags: `src/gateway/methods/core-descriptors.ts`
- [v2026.6.11 descriptor source](https://raw.githubusercontent.com/openclaw/openclaw/v2026.6.11/src/gateway/methods/core-descriptors.ts)
- [v2026.8.1 descriptor source](https://raw.githubusercontent.com/openclaw/openclaw/v2026.8.1/src/gateway/methods/core-descriptors.ts)
- [Pinned GitHub tag comparison](https://github.com/openclaw/openclaw/compare/v2026.6.11...v2026.8.1)
- AgentOS starting main HEAD: `ad8416910df411f194c0b60e1f8b45e91dcb2a7f`
- Original Phase 1 branch: `upgrade/openclaw-2026.8.1`
- The comparison uses the two exact release tags. `main` is not used as an OpenClaw comparison source.

## Baseline Constants

These were the historical AgentOS baseline constants at the time of this audit:

- `OPENCLAW_RECOMMENDED_VERSION = "2026.8.1"`
- `OPENCLAW_SUPPORTED_BASELINE_VERSION = "2026.8.1"`

The active constants are now `2026.8.2`; this document retains the 8.1 values only as historical comparison evidence.

The `2026.6.11` to `2026.8.1` comparison below is retained as historical static compatibility evidence, not as the active runtime policy.
- Current AgentOS package root version: `0.1.0`
- Published AgentOS package version: `0.7.6`

No OpenClaw runtime binary, session store, SQLite state, hosted deployment, or AgentOS release version was upgraded in the historical Phase 1 analysis.

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
- Explicit semantic replacements in the AgentOS compatibility model: 0 for this tag pair
- Renames proven by the descriptor evidence: 0

Removed methods:

`doctor.memory.remHarness`, `node.pair.request`, `node.pair.verify`, `sessions.compaction.get`, `sessions.unsubscribe`, `talk.session.cancelTurn`, `talk.session.endTurn`, `talk.session.join`, `talk.session.startTurn`, and `voicewake.routing.set`.

No removed method is classified as replaced for this tag pair. Shared AgentOS operation membership is retained as operation-survival evidence only; it is not semantic replacement evidence. In particular, the presence of another session, pairing, Talk, memory, or voice-wake method does not prove that it replaces a removed method. The compatibility model supports explicit replacement evidence for future cases, but no declared relation matches these ten removals.

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

Local exact tag diff evidence found 518 changed files under `src/gateway/server-methods/` and 211 changed files under `packages/gateway-protocol/`. No changed files were found under `src/gateway/protocol/` in that local exact diff. These are implementation/protocol evidence, not runtime proof, and must not be conflated with the bounded GitHub Compare API listing.

### Dynamic authorization evidence

The exact target authorization implementation confirms that `dynamic` is a sentinel, not a grant. The target resolves least-privilege authorization from request parameters and runtime state in `src/gateway/method-scopes.ts`, including:

- `sessions.create`, `sessions.patch`, and `sessions.delete` through the parameter-aware session policy in `src/shared/session-method-scopes.ts` and `src/shared/session-method-scopes-base.ts`;
- `node.invoke` from the requested command, node target, pairing, and approval policy;
- `agent` from the message command, including lifecycle commands; and
- `talk.config` from `includeSecrets` and the active profile/provider state.

The related pinned source files are [core descriptors](https://github.com/openclaw/openclaw/blob/ea806575e6450e4d1efdfc72c19f04be982a1b9b/src/gateway/methods/core-descriptors.ts), [method scope resolution](https://github.com/openclaw/openclaw/blob/ea806575e6450e4d1efdfc72c19f04be982a1b9b/src/gateway/method-scopes.ts), [operator scope implications](https://github.com/openclaw/openclaw/blob/ea806575e6450e4d1efdfc72c19f04be982a1b9b/src/shared/operator-scope-compat.ts), and [session dynamic scope policy](https://github.com/openclaw/openclaw/blob/ea806575e6450e4d1efdfc72c19f04be982a1b9b/src/shared/session-method-scopes-base.ts).

AgentOS marks all changed `dynamic` or `node` descriptor rows with `authorizationEvidence: "runtime-required"` and status `unknown`. Advertisement alone therefore does not certify authorization. The v2026.6.11 to v2026.8.1 comparison contains 16 such changed rows: six scope transitions, nine additions, and one policy-only change for `agent`.

## Implementation

- `lib/openclaw/application/update-contract-diff-service.ts` now parses legacy object descriptors and v8 tuple descriptors, including policy metadata and exact-tag scope names.
- The parser enforces source-size and row-count bounds, validates method names/scopes/since-tags, rejects malformed or duplicate rows, and fails closed without executing OpenClaw source.
- Static diff results now retain registered versus advertised counts and classify blocker, warning, safe, and unknown evidence.
- Required operation loss is the only static blocker condition unless the compatibility model contains explicit semantic replacement evidence. An unrelated method surviving in the same operation never preserves a removed required method. Optional or experimental loss remains warning evidence even when an operation disables CLI fallback.
- Removed methods are classified as `replaced` only by an explicit `replacementEvidence` relation owned by the compatibility model. The exact v2026.6.11 to v2026.8.1 tag diff has zero such replacements.
- Scope transitions use explicit scope semantics. `dynamic` and `node` transitions are unknown until runtime authorization and payload behavior are verified; fixed dedicated-scope changes are warnings rather than numeric privilege escalation.
- GitHub Compare file evidence is read as a bounded collection, not as a reliable paginated file inventory. When the API reports `diverged` or a capped commit distance, AgentOS emits incomplete-comparison unknown evidence and never treats absent implementation or protocol paths as unchanged.
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
- explicit replacement evidence versus unrelated operation siblings;
- realistic `status: "diverged"` / capped-commit Compare API truncation;
- dynamic and node authorization rows that remain runtime-required;
- invalid release input with zero network calls;
- compatibility checks where write authorizes read/Talk and dedicated question scope remains exact.

## Verification

The relevant repository commands were run with Node `v24.15.0` and pnpm `10.30.3`:

```text
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

The historical Phase 1 analysis does not claim runtime compatibility. The core 2026.8.1 Gateway session, method payload probes, session continuity, model execution, config, cron, restart, SQLite, and doctor checks are now covered by the Phase 2C fresh-baseline artifact. Node pairing, Talk turns, and semantic memory search remain environment-dependent and outside the baseline gate.

Historical Phase 1 validation recorded for the branch: the focused OpenClaw regression set passed 190 tests; `pnpm typecheck`, `pnpm lint`, and `pnpm build` passed. Current Phase 2C validation is recorded in the fresh-baseline evidence artifact.

The full-suite A/B check used the same `pnpm test` command against a clean worktree at `ad8416910df411f194c0b60e1f8b45e91dcb2a7f` and the hardening branch. Both runs reproduced the same five pre-existing static/source-shape failures:

- `inspector visual tones provide distinct light and dark compact surfaces`: expected `/255,253,251/`; actual light tone `border-[#ddcec3] bg-[#fbf7f3] ...`.
- `mobile inspector moves scope controls into the header and reserves the rail for desktop`: expected `/mt-3 grid grid-cols-3[\\s\\S]*lg:hidden/`.
- `workspace creation provides a compact mobile-first basic flow`: expected `/contentClassName="h-[100dvh] max-h-[100dvh] w-screen rounded-none/`.
- `mission shell supports hover and pinned sidebar modes`: expected `/aria-label=\\{isSidebarOpen \\? "Close navigation" : "Open navigation"\\}/`.
- `settings control center renders a single hash-selected section`: expected `/\\{ id: "general", label: "General", icon: Wrench \\}/`.

Both full-suite processes then remained open at `tests/openclaw-workspace-service.test.ts` and were interrupted after reaching the same pending-file state. Running that file alone reached all 13 assertions in both worktrees but neither process exited; both were interrupted at the same file-level pending state. The isolated `tests/openclaw-adapter.test.ts` passed 11/11 at both revisions, so the one concurrent full-suite observation of that test was not treated as a branch regression.

## Deferred Findings

- Runtime verification against an actual v2026.8.1 Gateway.
- Payload and error-shape checks for newly added methods.
- Dynamic authorization verification for sessions, nodes, agents, Talk configuration, and parameter-sensitive filesystem methods. Static rows now explicitly preserve this runtime requirement.
- Full session continuity and subscription behavior across update/restart.
- Node pairing, Talk turn lifecycle, memory doctor, model auth, config policy, and automation control-plane smoke tests.
- Review of the complete 194-method addition set beyond the mapped AgentOS surfaces.

## Known Risks

- The static evidence is authoritative only for the two pinned source tags and cannot prove runtime behavior.
- A GitHub Compare endpoint can report a divergent/capped comparison with only a bounded file collection. AgentOS therefore cannot certify missing implementation or protocol categories from absent file entries.
- The target adds substantial Gateway surface area and protocol implementation churn; Phase 2 must run a real runtime matrix before any target is certified.

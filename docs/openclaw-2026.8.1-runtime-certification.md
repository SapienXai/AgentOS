# OpenClaw 2026.8.1 Runtime Certification

Certification date: 2026-08-31

This document records a real native Gateway probe against an isolated OpenClaw `2026.8.1` runtime. It does not promote `2026.8.1` to the AgentOS recommended or supported version, and it does not change the AgentOS published version.

## Provenance

- Repository: AgentOS
- Branch: `upgrade/openclaw-2026.8.1`
- Starting commit: `ff9e110c1b70cfb2dfb749510d3ff8c35c170714`
- Starting remote: `origin/upgrade/openclaw-2026.8.1` at the same commit
- AgentOS root version: `0.1.0`
- AgentOS package version: `0.7.6`
- `OPENCLAW_RECOMMENDED_VERSION`: `2026.6.11` (unchanged)
- `OPENCLAW_SUPPORTED_BASELINE_VERSION`: `2026.6.8` (unchanged)
- OpenClaw runtime tag: `2026.8.1`
- OpenClaw runtime build SHA: `ea806575e6450e4d1efdfc72c19f04be982a1b9b`
- OpenClaw build ID: `2026.8.1-ea806575e645-2026-08-31T00-16-08.235Z`
- Host: macOS `26.5.2`, Darwin arm64
- Node: `v24.15.0`
- pnpm: `10.30.3`

The source comparison was pinned to the OpenClaw `2026.8.1` commit above. No credentials, tokens, recovery values, device keys, or raw secret-bearing payloads are included here.

## Isolated Runtime

OpenClaw `2026.8.1` was downloaded from the npm registry into a temporary runtime root and installed with `npm install --ignore-scripts --no-package-lock --omit=optional --legacy-peer-deps`. The binary reported `OpenClaw 2026.8.1 (ea80657)`.

The Gateway ran in the temporary root `/tmp/agentos-openclaw-2026.8.1-runtime.3O13Q3` with:

- isolated `OPENCLAW_STATE_DIR`
- loopback WebSocket endpoint `ws://127.0.0.1:28789`
- token authentication supplied through the process environment only
- isolated development workspace and agent state
- isolated shared SQLite state at `state/state/openclaw.sqlite`

The existing developer OpenClaw `2026.6.11` process on port `18789` and its state were not modified. The temporary Gateway process was restarted during certification and remained isolated.

## Gateway Handshake

The AgentOS native WebSocket client completed a real `connect` handshake against `2026.8.1`:

- protocol: `4`
- authenticated role: `operator`
- requested full scopes: `operator.admin`, `operator.read`, `operator.write`, `operator.approvals`, `operator.questions`, `operator.pairing`, `operator.talk.secrets`
- advertised methods: `371`
- advertised events: `55`
- installed server version matched the target: `2026.8.1`

The probe used `NativeWsOpenClawGatewayClient.callNative` directly. It did not exercise AgentOS CLI fallback paths as evidence for native runtime behavior.

## Runtime Certification Summary

| Result | Count |
| --- | ---: |
| PASS | 43 |
| FAIL | 0 |
| SKIPPED | 7 |
| EXPECTED-DENIAL | 7 |
| UNKNOWN | 0 |
| Total probes | 57 |

The final run had no runtime failures. The skipped paths are environmental, destructive, or provider/device dependent and are not treated as passes.

## Dynamic Authorization

The highest-priority parameter/state-sensitive authorization surfaces were tested with a full operator client and a separate read-only operator client using the same isolated Gateway token:

- `sessions.create`: normal creation passed; read-only request returned `FORBIDDEN: missing scope: operator.write` as EXPECTED-DENIAL.
- `sessions.patch`: label patch and archive lifecycle patch passed; read-only patch returned missing `operator.write` as EXPECTED-DENIAL.
- `sessions.delete`: archived-only deletion passed; ordinary read-only deletion returned missing `operator.admin` as EXPECTED-DENIAL.
- `node.invoke`: no paired node was available, so real delivery was SKIPPED; a valid read-only invocation request was rejected for missing `operator.write` as EXPECTED-DENIAL.
- `agent`: a valid read-only invocation request was rejected for missing `operator.write` as EXPECTED-DENIAL. No model run was started.
- `talk.config`: ordinary configuration read passed; `includeSecrets: true` from the read-only client returned missing `operator.talk.secrets` as EXPECTED-DENIAL.

This proves the tested authorization boundaries only. It does not certify every dynamic branch for every parameter combination.

## Sessions / Chat / Streaming

The disposable session lifecycle passed end to end through native Gateway methods:

- `sessions.create`, `sessions.describe`, `sessions.preview`, `sessions.patch`, `sessions.abort`, and archived-only `sessions.delete`
- `chat.history` returned the expected `sessionKey`, `sessionId`, `messages`, pending-input, pagination, defaults, and session-info fields
- `sessions.subscribe` passed
- modern `sessions.messages.subscribe` and `sessions.messages.unsubscribe` both passed

`chat.send` and provider-backed streaming were SKIPPED because the isolated runtime had no model credentials and the probe must not incur provider cost. Therefore no claim is made about a completed model turn, streamed token sequence, or tool event continuity.

## Agents

`agents.list` passed. A disposable agent was created, updated, listed through the catalog, and deleted successfully. The disposable workspace was outside the repository and was not retained as product state.

## Config

The following native config surfaces passed:

- `config.get` returned a config snapshot and hash
- `config.schema` returned a schema
- `config.schema.lookup` for `gateway` returned a schema
- a no-op `config.patch` with the current base hash passed
- the read-only config mutation returned missing `operator.admin` as EXPECTED-DENIAL

No production configuration was changed. The no-op patch was performed only in the isolated state.

## Models / Auth

`models.list` and `models.authStatus` passed and returned the expected catalog/provider containers. `models.probe` was SKIPPED because provider credentials were absent and probing can perform external work. `models.authLogout` was SKIPPED because credential logout is destructive.

## Approvals / Questions

`exec.approval.list` passed and returned an array. The disposable question flow passed through `question.request`, `question.get`, `question.waitAnswer` with an intentionally short wait, and `question.resolve` cancellation. The question used non-secret test content and was resolved before cleanup.

## Node / Device

`node.list`, `node.pair.list`, and `device.pair.list` passed. The isolated runtime had no paired node, so actual command delivery through `node.invoke` was SKIPPED. The read-only authorization denial for a valid `node.invoke` request passed independently. No physical device, pairing approval, or device command was created.

The target advertises modern pairing methods; the older `node.pair.request` and `node.pair.verify` names are absent. This is recorded as target contract evidence, not treated as a failure because the modern pairing surface is advertised and list discovery passed.

## Talk

`talk.config` and `talk.catalog` passed. Secret-inclusive Talk configuration was correctly denied to the read-only client. `talk.session.create` and audio transport were SKIPPED because no Talk provider, microphone, or audio transport was configured. No audio was sent and no speech provider was invoked.

## Memory

`doctor.memory.status` and `doctor.memory.dreamDiary` passed for the isolated `dev` agent. `memory.search` was SKIPPED because embedding credentials were not configured. The target does not advertise the older `doctor.memory.remHarness` method; this remains a static-to-runtime follow-up item rather than a fabricated compatibility pass.

## Cron / Automations

`cron.status` and `cron.list` passed. A disabled disposable `cron.add` job using a safe `systemEvent` payload on the main session target was created, updated, and removed successfully. `cron.run` was SKIPPED because execution would enter an agent runtime without model credentials. The disposable job was not left behind.

## Restart / Recovery

`gateway.restart.preflight` passed and reported the structured safety snapshot. `gateway.restart.request` was accepted by the isolated Gateway, the WebSocket disconnected/reconnected, and a fresh native handshake succeeded. No in-flight model work existed, so no turn continuity claim is made beyond control-plane recovery.

## SQLite / Doctor Discovery

OpenClaw `database preflight` on the live WAL-backed database correctly returned `indeterminate` because the database had `-wal` and `-shm` sidecars. A WAL-aware SQLite online backup produced a standalone copy; preflight of that copy returned:

- target schema version: `15`
- found schema version: `15`
- issues: `[]`
- status: `exact`
- requires write: `false`

`doctor --session-sqlite inspect --session-sqlite-agent dev --json` passed with no issues, SQLite integrity `ok`, two SQLite entries, and no legacy/unreferenced files. This was discovery and validation only; no migration, compaction, repair, or reset was run.

`doctor --lint --json` returned `ok: false` with two isolated-environment warnings: the token is environment-supplied rather than persisted in config, and loopback binding does not expose a node onboarding URL. `doctor --post-upgrade --json` reported an isolated plugin index unavailable finding. These are retained as environmental findings and were not silently converted to runtime failures.

## Static → Runtime Evidence Bridge

The new bridge matches static evidence and runtime proof by exact method name and exact target version. It preserves static `unknown` rows, ignores proofs for another method or target version, treats a runtime `FAIL` as authoritative over optimistic static evidence, and requires a matching proof before promoting `runtime-required` rows.

The final bridge contained:

- static source: `github-static`
- static comparison: `2026.6.11` → `2026.8.1`
- static target advertised method count: `371`
- static blockers: `0`
- static warnings: `29`
- static unknowns: `17`
- certified rows: `18`
- failed rows: `0`
- runtime-required rows still uncertified: `9`
- static-only rows: `204`

The remaining uncertified runtime-required rows are `channels.pairing.approve`, `fs.listDir`, `node.invoke.progress`, `node.pluginTools.update`, `node.runnerInventory.update`, `node.skills.update`, `sessions.dispatch`, `sessions.move`, and `sessions.patchMany`. Missing proof is intentionally not treated as certification.

## Compatibility Fixes

No OpenClaw behavior or AgentOS fallback policy required a compatibility fix during this run. The implementation changes are certification infrastructure and a handshake type addition for the observed target `server.buildId` field. Existing recommended/baseline version constants and AgentOS published versions were unchanged.

## Tests

- `pnpm exec tsc --noEmit` — passed
- targeted native certification and evidence bridge tests — 10 passed
- real `pnpm openclaw:runtime-cert` against the isolated `2026.8.1` Gateway — 43 PASS, 0 FAIL, 7 SKIPPED, 7 EXPECTED-DENIAL, 0 UNKNOWN
- `database preflight` on WAL-aware standalone backup — exact, no issues
- `doctor --session-sqlite inspect` — no issues, SQLite integrity `ok`

The full `pnpm test` suite was also attempted. It produced no assertion failure before an existing `tests/openclaw-workspace-service.test.ts` child remained idle for more than three minutes; the run was interrupted and is not reported as a passing full-suite result.

## Verification

The native handshake and all certification calls used the isolated loopback Gateway at port `28789`. The token was read from the isolated process environment without being printed or persisted in the repository. The existing port `18789` Gateway was not controlled by the harness.

The runtime report was written outside the repository at `/tmp/agentos-openclaw-2026.8.1-runtime.3O13Q3/runtime-certification.json`. It contains only sanitized metadata, response-shape evidence, statuses, and error categories.

## Files Changed

- `lib/openclaw/client/native-ws-gateway-types.ts`
- `lib/openclaw/runtime-certification/types.ts`
- `lib/openclaw/runtime-certification/harness.ts`
- `lib/openclaw/runtime-certification/evidence-bridge.ts`
- `scripts/openclaw-runtime-certification.ts`
- `tests/openclaw-runtime-certification.test.ts`
- `tests/openclaw-runtime-evidence-bridge.test.ts`
- `package.json`
- `docs/openclaw-2026.8.1-runtime-certification.md`

## Claim / Evidence Matrix

| Claim | Implementation evidence | Runtime evidence | Test / limitation |
| --- | --- | --- | --- |
| Native 2026.8.1 Gateway is reachable | Native WebSocket client and native-only call path | Protocol 4 handshake, version `2026.8.1`, 371 methods, 55 events | Real isolated runtime; no production Gateway mutation |
| Sessions create/patch/delete authorization is state-aware | Per-client scopes and dynamic probes | Normal lifecycle PASS; read-only denials EXPECTED-DENIAL | Tested disposable session branches only |
| Agent/node/Talk dynamic authorization is enforced | Read-only negative probes | `agent`, `node.invoke`, and secret Talk config denied at the Gateway | Node delivery and Talk session remain environment-skipped |
| Session event subscription contract works | Modern subscribe/unsubscribe probes | `sessions.subscribe` and message subscribe/unsubscribe PASS | Model streaming skipped without credentials |
| Config and model read surfaces are compatible | Native method probes and shape checks | Config schema/get/lookup/patch and model list/auth status PASS | Provider probe and logout skipped |
| SQLite state is structurally compatible | OpenClaw CLI discovery | WAL-aware backup preflight exact at schema 15; inspect integrity ok | No migration or repair performed |
| Static unknowns are not over-promoted | Exact method/version evidence bridge | 9 runtime-required rows remain uncertified | 204 static-only rows retain static evidence |

## Deferred Findings

- Provider-backed `chat.send`, streaming, `models.probe`, `cron.run`, and semantic `memory.search` need a separately authorized credentialed test environment.
- Talk session/audio transport needs a configured provider and microphone/audio fixture.
- Node command delivery needs a disposable paired node and safe command allowlist.
- Remaining dynamic static rows need targeted runtime probes before they can be certified.
- The isolated plugin index is missing for post-upgrade doctor checks.

## Known Risks

- Passing control-plane, authorization, config, and lifecycle probes does not imply model/provider, external channel, physical node, or audio readiness.
- AgentOS currently reports the tested target as evidence only; it does not change the recommended or supported OpenClaw policy.
- The isolated doctor warning about environment-only token configuration should be resolved or explicitly accepted before using the package as a production upgrade candidate.

## Commit

The certification change is committed separately after final validation. The final commit SHA is recorded in the task report. The commit subject is:

`test(openclaw): certify 2026.8.1 runtime contract`

## Phase Verdict

`PHASE 2A INCOMPLETE`

The native Gateway, handshake, control-plane lifecycle, dynamic authorization boundaries, SQLite schema preflight, and recovery path are certified for the tested surfaces. Phase 2A is incomplete because credentialed model/streaming/memory/cron execution, Talk audio, physical node delivery, and nine runtime-required static rows remain unproven.

## Recommended Next Phase

Phase 2B is recommended only after a controlled credentialed/device fixture is available and the nine remaining runtime-required rows are probed. Phase 2B should begin with those deferred runtime surfaces and explicit acceptance of the isolated doctor/plugin findings; it should not promote `2026.8.1` to the default AgentOS policy until those gaps are resolved.

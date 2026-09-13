# AgentOS / OpenClaw Pre-Merge Audit — 2026-09-13

Status: repository-level audit and correction on `codex/auto-dev` against
`main`. This report does not merge, deploy, publish, tag, mutate GitHub issues,
or touch production state. Repository evidence and executable tests are the
authority; historical reports and prior completion claims are not.

The fresh machine-readable certification is generated only after the final
non-evidence code commit. Its `provenance.certifiedCodeHead` and
`provenance.evidenceCommit` fields are authoritative for the exact final
provenance. The historical artifacts retained in `docs/evidence/` are not
promoted by this report.

## Repository reconstruction

At audit start:

| Fact | Evidence |
| --- | --- |
| Branch | `codex/auto-dev` |
| Starting branch HEAD | `55283ae0bed387761537a22b1f83cf0e6b141def` |
| `main` HEAD | `56196feeceae9f31b4949608c4fdadc3a32e9d76` |
| Merge-base | `56196feeceae9f31b4949608c4fdadc3a32e9d76` |
| Starting ahead/behind | 9 ahead, 0 behind |
| Starting branch commits | 9, independently classified from `git log` |
| Starting changed paths | 63 paths from merge-base to branch HEAD |
| Starting worktree | clean; no untracked files |
| Recovery state | preserved pre-existing stash; no reset, discard, or destructive recovery was used |

The nine branch commits were classified as release alignment, Railway image
contract tests, native task history, native environment preparation, adapter
boundary cleanup, ownership documentation, task-history ownership correction,
native capability catalog, and governed CLI fallback inventory. A full
merge-base-to-HEAD diff review was performed before implementation changes.

## Version Truth Matrix

These values are intentionally separate concepts. A repository pin is not a
live runtime observation, and a certified package is not proof of a Railway
deployment.

| Role | Version/value | Evidence | Static/Live | Verdict |
| --- | --- | --- | --- | --- |
| Supported minimum | `2026.9.1` | `lib/openclaw/versions.ts`; [9.1 compatibility audit](openclaw-2026.9.1-compatibility-audit.md); 9.1 runtime/fresh-baseline evidence and baseline tests | Static repository policy plus disposable historical runtime evidence | KEEP; high confidence |
| Recommended | `2026.9.4` | `lib/openclaw/versions.ts`; [9.4 compatibility audit](openclaw-2026.9.4-compatibility-audit.md); release consistency tests | Static policy | Promoted; high confidence |
| Native contract | `2026.9.4` | `lib/openclaw/versions.ts`; `lib/openclaw/identity/contract.ts`; exact contract diff | Static policy/contract | Promoted; high confidence |
| Identity contract | `2026.9.4` | `lib/openclaw/identity/contract.ts`; exact tag/source/build/schema assertions | Static contract | Exact target; high confidence |
| `@openclaw/gateway-client` package | `2026.9.4` | `package.json`, `pnpm-lock.yaml`, and exact 9.4 package-integrity evidence in [contract diff](evidence/openclaw-2026.9.3-to-2026.9.4-contract-diff.json) | Static build dependency; registry metadata captured in evidence | Exact; high confidence |
| `@openclaw/gateway-protocol` package | `2026.9.4` | `package.json`, `pnpm-lock.yaml`, exact protocol package integrity, and local `protocol.schema.json` | Static build dependency | Exact; high confidence |
| OpenClaw package used by the exact disposable certification | `2026.9.4` | tag `v2026.9.4`, source/build identity, and package hash in 9.4 runtime evidence | Static evidence of disposable runtime | Exact package; not production proof |
| `main` Railway image | `ghcr.io/openclaw/openclaw:2026.9.3@sha256:6cb72e1599b3b76e2ea3dcc2f4dd7f112247367fbecadfcdee8caa7423f4989b` | `main:Dockerfile.railway` | Static deployment configuration | Existing baseline; not live proof |
| Branch Railway image | `ghcr.io/openclaw/openclaw:2026.9.4@sha256:cc596b846506a5f4cfcee111394a2725f375f01cca2ebb492a161fd1b747f101` | `codex/auto-dev:Dockerfile.railway` | Static deployment configuration | Repository candidate prepared for 9.4; not live proof |
| Actual live Railway runtime | `UNKNOWN` | No authorized live Railway inspection was performed | Live | NOT VERIFIED |
| Migration source runtime | `2026.9.3`, state schema `16`, agent schema `19` | [9.3 → 9.4 migration evidence](evidence/openclaw-2026.9.3-to-2026.9.4-migration.json) | Static evidence of isolated disposable migration | Exact source fixture |
| Migration target runtime | `2026.9.4`, state schema `17`, agent schema `19` | [9.3 → 9.4 migration evidence](evidence/openclaw-2026.9.3-to-2026.9.4-migration.json) | Static evidence of isolated disposable migration | Exact target fixture |
| Gateway protocol | `v4` | exact 9.4 tag/package identity and contract diff | Static contract plus disposable runtime evidence | Exact |
| OpenClaw state schema | `17` target; `16 → 17` migration | exact package identity and migration evidence | Static contract plus disposable runtime evidence | Exact |
| OpenClaw agent schema | `19` | exact package identity and migration/contract evidence | Static contract plus disposable runtime evidence | Exact |
| Exact certified release identity | tag `v2026.9.4`; signed tag object `8bec206f3c1f787e1e9c45cfd34d3de2a78c7b8e`; peeled source `3a9d69db306cd7f081e06254cb89c4bcc14a7107`; build `2026.9.4-release-3a9d69db306c-2026-09-10T22-53-16.719Z` | [exact 9.3 → 9.4 contract diff](evidence/openclaw-2026.9.3-to-2026.9.4-contract-diff.json) and [release audit](openclaw-2026.9.4-compatibility-audit.md) | Static release identity plus disposable exact package | Exact; high confidence |
| AgentOS package | `0.7.9` published package; root private package remains `0.1.0` | `packages/agentos/package.json`, root `package.json`, release consistency tests | Static package metadata | Intentional; high confidence |

The 9.4 npm integrity values recorded by the exact contract evidence are:

- OpenClaw: `sha512-lTQpEEe1Xm3u2PCHaPEr+vP8paGk1vLdHuzdItsNToaLI6hAqRVvgJYg+GxukJhETJp4tPy/S1Gftl4KuB8n7A==`
- Gateway client: `sha512-MQSj/agWzPMvPbWIyh5azarYYJvxcrc9TVdPn22zdGAfW7SAOpocpa/ImOi8YcIDk6IILXvv0nRDFKXQnjMS6A==`
- Gateway protocol: `sha512-arnDRQV4d7yP1veI0i3UWJSrRk7ehgM0N8n0kQoVc0yP6/cy40GZmshh10RD/ZASrhGeZGDXbVQBjSHIHgrtDg==`

### Supported minimum decision

**KEEP 2026.9.1.** The 9.1 runtime and fresh-baseline evidence passed the
required identity, protocol, authorization, persistence, Doctor, and
no-parallel-migration checks. Current compatibility tests retain 9.1-specific
scope/security behavior and explicit degraded/unsupported/fallback states.
The 9.4 additions are capability-gated and native-first; no audited feature
proved that 9.1 must be removed, and no feature-gating insufficiency or unsafe
9.1 behavior was found. The 9.3 Railway image is not used as a reason to raise
the minimum.

## Seven-phase truth audit

“Complete” below describes the requested repository scope, not live production
certification. Live and production proof remain separate columns.

| Phase | Actual status | Implementation | Tests | Product exposure | Live proof | Production proof | Remaining limitation |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1. Release/deployment alignment | COMPLETE WITH MINOR GAPS | Exact 9.4 identity, contract diff, 9.3 → 9.4 migration evidence, immutable Railway digest candidate, and version-role separation | Exact contract, migration, Railway, release-consistency, and provenance tests | Version/update diagnostics distinguish policy, package, deployment, and live claims | Disposable exact package only | NOT RUN; Railway not inspected | External Railway promotion and live runtime verification remain pending |
| 2. Native task intelligence / `tasks.history` | COMPLETE | Native task ID and history adapter/domain projection, bounded opaque pagination, task detail/output/warning/artifact projection, event refresh | Task-history/detail/stream and native Gateway tests; included in focused 154-test transport/release run | Task detail uses native history and labels degraded legacy recovery | Local/disposable contract evidence only | NOT RUN | Exact live task authorization and data volume depend on the connected Gateway |
| 3. Native workspace/environment preparation | COMPLETE | Bounded native environment inventory, operator profile selector, opt-in `environments.prepare`, idempotent/reusable preparation, resumable provisioning | Environment, topology, workspace creation/provisioning, and UI contract tests | Create Workspace exposes native profiles and honest unavailable/denied/unsupported states | No external provider allocation performed | NOT RUN | Native inventory is unavailable until a connected Gateway supplies it; provider cost remains unknown when OpenClaw does not report it |
| 4. Adapter/domain architecture cleanup | COMPLETE | Narrow domain ports remain behind one official Gateway transport/coordinator and one event/reconnect owner | Adapter-boundary, architecture-lock, official transport/coordinator, event bridge, and import-guard tests | Diagnostics expose transport/fallback evidence without exposing low-level clients | Local contract harness only | NOT RUN | No live multi-process Gateway ownership test was authorized |
| 5. Roadmap/ownership reconciliation | COMPLETE WITH MINOR GAPS | Ownership matrix, release lifecycle reconciliation, historical evidence reclassification, canonical audit report | Ownership, release watcher dry-run, stale metadata, identity mismatch, and provenance tests | Repository docs and watcher summaries explain stale/current/blocked states | GitHub issue metadata was read only | NOT RUN; no issue mutation | Issue #31 remains externally stale until an explicitly authorized dry-run result is applied |
| 6. Workspace-aware native capability/plugin discovery | COMPLETE | Native-only browse/categories/detail service, server-side workspace/agent context propagation, bounded relevance explanation, redaction, Add Capability projection | Catalog route/context/detail/pagination/denial/malformed/no-fallback tests | Add Capability displays native identity, category, local state, relevance reason, setup guidance, and honest errors | No live catalog endpoint was used | NOT RUN | Installation/mutation is intentionally OpenClaw-owned and not certified by AgentOS |
| 7. CLI fallback governance and compatibility lifecycle | COMPLETE WITH MINOR GAPS | 33-entry governed registry, exact 9.4 candidate audit, explicit fallback activation diagnostics, epistemic compatibility states, release watcher reconciliation | Fallback, compatibility semantic, update, release lifecycle, and full focused regression tests | Diagnostics distinguish expectation, advertisement, observation, denial, unsupported, fallback availability, and actual fallback use | Disposable/local evidence only | NOT RUN | Remaining legacy/setup fallbacks require future native proof and operator authorization before removal |

## Architecture verdict

The audited implementation preserves the required boundary:

- one AgentOS product/control/projection layer;
- one OpenClaw runtime authority for agents, sessions, tasks, workspaces,
  environments, plugins, credentials, persistence, migration, and updates;
- one official Gateway transport and one reconnect/event-stream owner;
- no AgentOS task engine, session engine, worktree registry, worker authority,
  plugin database, migration journal, updater, second WebSocket stack, or blind
  mutation retry engine.

The [architecture lock tests](../tests/openclaw-architecture-lock.test.ts),
adapter boundary tests, import guards, and official coordinator tests enforce
this decision. AgentOS-owned state is limited to intent, policy, projections,
correlation, explanations, diagnostics, and sidecars.

## Exact OpenClaw 2026.9.4 contract

The certified target is the exact `v2026.9.4` release above, not upstream
`main`. The local protocol schema and exact release evidence verify:

- `tasks.history`: `operator.read`; task ID plus opaque cursor; bounded limit
  `1..200`; native messages and `nextCursor`.
- `environments.prepare`: `operator.admin`; `profileId` plus project path;
  native `environmentId`, `preparationKey`, and `reused` result.
- `plugins.catalog.browse`: `operator.read`; bounded query/category/cursor and
  page size, with exact plugin ID grammar.
- `plugins.catalog.categories`: `operator.read`; native category records.
- `plugins.catalog.get`: `operator.read`; exact plugin ID/version detail.

Request/response normalization, scope handling, pagination, cursor opacity,
authorization, lifecycle/reuse, unsupported-method handling, malformed-result
handling, and redaction are covered by the exact contract and focused tests.

Deliberately unsupported or unimplemented capabilities include AgentOS-side
plugin installation/mutation, synthetic `tasks.assign`, and any native method
not present in the exact 9.4 schema. Upstream `main` release-note or schema
signals remain future signals and are not silently treated as certified 9.4
behavior.

## Fallback inventory

The independently checked registry contains **33** entries:

| Measure | Count |
| --- | ---: |
| Allowed fallback paths | 32 |
| Disallowed fallback paths | 1 (`plugin-catalog.native-only`) |
| `native-nonexistent` | 3 |
| `native-unintegrated` | 4 |
| `legacy-baseline` | 8 |
| `setup-recovery` | 15 |
| `technical-debt` | 3 |
| `unsafe` | 0 |
| `obsolete` | 0 |

Every source path and anchor resolves, every claimed native candidate is
present in the exact installed 9.4 schema, and fallback availability is kept
separate from actual runtime activation. Runtime diagnostics record actual
fallback counts/records. Legitimate bootstrap, Gateway-unavailable recovery,
Doctor/repair, explicit local setup, and minimum-version compatibility paths
remain governed. Plugin catalog is native-only.

The next bounded removal candidates are the unintegrated model discovery and
agent-lifecycle paths after stable native equivalents are proven, followed by
legacy channel/setup recovery paths when their native contracts are available.
No fallback is removed merely to improve a coverage percentage.

## Release lifecycle and roadmap reconciliation

The watcher now follows the bounded lifecycle:

`discovered → intake → audit → certification → promotion → issue reconciliation
→ version policy consistency → deployment-config consistency`.

Dry-run reconciliation distinguishes certified evidence, stale issue metadata,
identity mismatch, repository deployment-pin match/mismatch, and live runtime
unknown. It does not mutate issues or version policy automatically. OpenClaw
2026.9.4 issue #31 is still externally marked NOT CERTIFIED/recommended 9.3;
that stale state was observed but not changed.

The current open roadmap remains valid where it asks for product work beyond
this branch. Recommended issue actions are:

| Issue | Current status | Code evidence | Recommended action |
| --- | --- | --- | --- |
| #31 compatibility intake | STALE EXTERNAL METADATA | exact 9.4 identity, contract, migration, and fresh final-evidence workflow | Run the watcher dry-run; reconcile only with explicit GitHub authorization; do not close automatically |
| #18 compatibility regression suite | PARTIAL / STILL VALID | versioned manifest, exact contract tests, evidence artifacts, semantic status model | Keep open for CI artifact upload, supported/candidate matrix expansion, and release-gate integration |
| #19 worker lifecycle | STILL VALID | native lifecycle ownership and runtime projections exist; no AgentOS lifecycle authority added | Re-scope toward native lifecycle projection, bounded operator policy, and recovery UX |
| #20 worker handoff/delegation | STILL VALID | native session/task dispatch and correlation exist | Add typed native handoff lineage only when an exact OpenClaw contract exists; do not create a local delegation engine |
| #21 health/retry/recovery | STILL VALID | official reconnect owner, request policy, Doctor/update projections, bounded recovery guidance | Add operator-facing native health/recovery projection; do not build a second retry ledger |
| #15 multi-user profile isolation | STILL VALID | identity/scope boundary and native profile projections are tested | Define and implement real tenant/runtime/filesystem isolation before claiming multi-user support |
| #17 remote Gateway access | STILL VALID | local-first trusted-origin/auth guards | Complete explicit remote trust/TLS/auth model before enabling remote operation |
| #16 QR pairing | STILL VALID | pairing projection/security tests exist; no invented protocol | Keep design-first until OpenClaw exposes a certified pairing contract |
| #10 durable approval/audit history | STILL VALID | Human Control projection and redaction boundaries exist | Add durable operator audit persistence only with clear AgentOS sidecar ownership |
| #11 Discord/Telegram operation jobs | STILL VALID / DESIGN-FIRST | channel setup and routing boundaries exist | Define native session/job mapping and approval boundaries before implementation |
| #9 workspace/agent preset examples | STILL VALID / DOCS | workspace and agent preset code exists | Add real examples and README links |
| #8 first-run setup guide | STILL VALID / DOCS | setup, Doctor, and local-first flows exist | Document the current install/start/Doctor path and degraded states |
| #7 provider setup paths | STILL VALID / DOCS | provider/model setup and readiness projections exist | Document supported provider paths and native readiness checks |

No GitHub issue was changed by this audit.

## Railway promotion readiness

The branch has a valid immutable 9.4 Docker image pin and preserves the
existing persistent roots, OpenClaw config/state links, workspace path,
supervisor entrypoint, private Gateway URL, browser-worker dependencies, and
headless startup contract covered by `tests/railway-deployment.test.ts` and
related supervisor tests. The isolated migration evidence proves the 9.3
state-schema `16` to 9.4 state-schema `17` transition, agent schema `19`
continuity, reconnect, state preservation, and recovery behavior.

Classification: **REPO DEPLOYMENT CONFIG READY FOR 9.4**.

This is not “production running 9.4”. Actual Railway runtime, image pull,
volume contents, restart behavior, health/readiness, and rollback against the
live service were not inspected or mutated. OpenClaw remains the owner of
runtime migration, persistence, updater, rollback, and Gateway lifecycle.

## Historical certification provenance

The old file whose name implied a seven-phase final certification contained a
phase-1 artifact type/phase and pointed at the `main` commit. It was renamed
to [openclaw-2026.9.4-phase-1-release-contract-alignment-historical.json](evidence/openclaw-2026.9.4-phase-1-release-contract-alignment-historical.json)
without rewriting its contents. The release watcher treats it and other old
final artifacts as historical and non-promotable.

The fresh artifact is [openclaw-2026.9.4-pre-merge-final-certification.json](evidence/openclaw-2026.9.4-pre-merge-final-certification.json).
It must contain:

- schema-2 artifact type and `pre-merge-final-certification` phase;
- exact 9.4 package identity and all required artifact assessments;
- `certifiedCodeHead` for the final non-evidence code commit;
- a distinct, existing `evidenceCommit` binding;
- explicit `PASS`, `SKIPPED`, `EXPECTED-DENIAL`, and
  `ENVIRONMENT_LIMITED` distinctions;
- production status `not-tested` and no credentials/production mutation.

The artifact is generated after implementation and validation, then committed
separately so it cannot honestly certify its own not-yet-existing commit.


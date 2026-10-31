# OpenClaw update progress and reconnection

## Feature and UI decision

The operator should follow one update through installation, Gateway downtime,
reconnection and verified completion without refreshing or repeating the mutation.
OpenClaw owns the update, durable run ID, events, phases, restart and recovery.
AgentOS composes those facts into an operator projection and stores only browser
correlation metadata. It does not create a second updater or runtime ledger.

The existing Updates page, SectionCard/Button primitives and semantic status
tokens remain the visual foundation. A single update panel replaces the normal
release card while tracking. It contains version transition, phase steps, elapsed
time, last Gateway contact and an optional recorded-detail disclosure. Steps use
native phases, never invented percentages. The two-column mobile stage list
becomes six columns on desktop; all actions remain in normal document flow.
Status announcements exclude the ticking clock, and motion respects reduced
motion preferences. A completed panel requires server verification.

## Observation and recovery

- The authenticated `/api/openclaw/update-progress` SSE route uses the existing
  Gateway event bridge for `update.run.changed`. Serialized native reads reconcile
  missed events and reconnects. A stream failure automatically reconnects through
  EventSource; it never repeats `update.run`.
- Reads omit CLI registry discovery and use bounded native read timeouts. Last
  known phase/run survives missing snapshots; older reads cannot rewind progress.
- Browser metadata correlates a newly requested operation with its native run.
  It survives navigation/reload, expires after one day, and is never evidence of
  installation or success. A native active run also restores tracking by itself.
- A lost POST response remains an unknown admission/outcome while observation
  continues. Explicit admission rejection does not become a running operation.
- Native failed/rolled-back/skipped records remain visible with a review path.
  Healthy runtime alone cannot turn a failed record into success.
- After reconnect or reload, completion requires a succeeded native record with
  restart/version evidence, the actual running version, healthy Gateway,
  applied valid configuration, current native authorization, and the central
  required Gateway capability/protocol contract. An optional method such as
  `sessions.get` must not become an extra hidden release gate.

## Access and ownership

Observation requires `runtime.use`, rechecked during streaming against the same
actor. Responses contain only the normalized run/progress fields and are redacted,
uncached and closed on cancellation. Existing mutation permissions, single-use
confirmation, admission serialization and native updater delegation remain intact.

Validation covers outage retention, ordering, run correlation, browser metadata
validation/expiry, read-only observation, native completion evidence, missing
required capabilities, optional-method omission and negative health/auth/config
states. No new live upgrade or Gateway shutdown is required for these checks.

## Implementation inventory and validation

| File | Responsibility |
| --- | --- |
| `components/operations/updates/openclaw-update-progress-panel.tsx` | Responsive progress, reconnect, failure and verified completion panel. |
| `components/operations/updates/updates-page-content.tsx` | Native mutation submission, persistent correlation and automatic result reconciliation. |
| `hooks/use-openclaw-update-progress.ts` | Reconnecting EventSource observation and last Gateway contact. |
| `lib/openclaw/update-progress.ts` | Ordered progress merging and bounded browser metadata validation. |
| `lib/openclaw/application/update-progress-service.ts` | Lightweight native observation and normalized progress projection. |
| `app/api/openclaw/update-progress/route.ts` | Authenticated, redacted SSE with serialized reconciliation and cleanup. |
| `lib/openclaw/application/native-doctor-service.ts` | Durable completion verification and central required-capability checks. |
| `components/mission-control/sidebar.tsx` | Deterministic connecting text during initial hydration. |
| `components/operations/operator-truth-indicator.tsx` | Deterministic initial connection freshness label. |
| `tests/openclaw-update-progress.test.ts` | Outage, ordering, correlation, metadata and read-only route regression coverage. |
| `tests/openclaw-native-doctor-service.test.ts` | Durable completion, required/optional capabilities and negative evidence tests. |
| `tests/openclaw-normal-update-surface.test.ts` | Canonical native mutation and event observation boundaries. |
| This document | Ownership, UI decision, security and validation record. |

Validation on the current change: lint, typecheck, all 2,235 tests, production
build and diff whitespace checks passed. The production build emitted 11 broad
Turbopack file-pattern warnings in existing unrelated modules. A test fixture
initially omitted the native run trigger and an older surface test expected
polling; both were corrected before the final passing suite.

Live observation on installed OpenClaw 2026.10.9 returned `verified` with healthy
native state. The existing completed 10.6 → 10.9 run rendered as a verified result
and restored after reload. Desktop, mobile and light/dark presentations were
inspected. A stale development SSR bundle was resolved by restarting the web dev
server; the final reload had no new browser errors. The actual Gateway was not
stopped and a new upgrade was not initiated. Outage retention was validated with
regression fixtures; this is not a claim of a second live upgrade or full 10.9
release certification. The certified recommendation and minimum were unchanged.

The new endpoint is security sensitive: read permission is checked initially and
while streaming, the actor must remain the same, payloads are redacted, and no
mutation is dispatched by observation. No credentials or environment files were
changed. Nothing was published or pushed.

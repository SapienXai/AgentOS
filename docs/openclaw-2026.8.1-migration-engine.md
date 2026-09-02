# Historical OpenClaw 2026.6.11 to 2026.8.1 Migration Engine

> Historical 2026.8.1 artifact. The active certified AgentOS baseline is OpenClaw 2026.8.2; see [the current model/provider architecture](openclaw-2026.8.2-model-provider-architecture.md).

This document describes the retained AgentOS Phase 2B migration boundary for upgrading a historical OpenClaw runtime from `2026.6.11` to the exact `2026.8.1` build at commit `ea806575e6450e4d1efdfc72c19f04be982a1b9b`.

The 6.11 fixture and migration journal are compatibility infrastructure and evidence only. They are not the active AgentOS install or support path; fresh installs provision the current `2026.8.2` baseline directly.

OpenClaw remains the source of truth for runtime behavior, state schemas, migrations, Gateway RPC, sessions, transcripts, models, and cron. AgentOS owns the operator-facing plan, journal, isolation boundary, evidence, commit point, rollback control, and recovery API. The implementation is in [`lib/openclaw/migration-engine/`](../lib/openclaw/migration-engine/) and is exposed through the server-only migration service and authenticated [`/api/openclaw/migrations`](../app/api/openclaw/migrations/route.ts) route.

## Scope and provenance

The engine is intentionally narrow:

- Source must be OpenClaw `2026.6.11`.
- Target must be OpenClaw `2026.8.1` with the exact source commit above.
- AgentOS policy is recommended and supported baseline `2026.8.2`; this historical 8.1 migration flow remains available for regression coverage only.
- The target package is staged and started in an isolated state/config root before any live replacement.
- The managed install package is replaced only after the target doctor, runtime certification, and preservation gates pass.
- External process supervisors remain the owner of process replacement when detected or explicitly configured.

The source/target package identities are read from package metadata and `dist/build-info.json`, including package hashes and build IDs. The exact target provenance and the disposable real-runtime result are recorded in [`docs/evidence/openclaw-2026.6.11-to-2026.8.1-migration.json`](evidence/openclaw-2026.6.11-to-2026.8.1-migration.json).

## Migration lifecycle

The resumable state machine is:

`planned -> preflight -> snapshotting -> staging -> target-validating -> state-migrating -> target-starting -> postflight -> certifying -> committing -> target-starting -> certifying -> committing -> completed`

The second `target-starting` is the canonical live-path boot. The intervening steps are `stop-staged-target`, `swap-live-paths`, `start-canonical-target`, `post-commit-certification`, and `verify-target-sqlite`. The terminal and recovery states are `blocked`, `failed`, `rollback-required`, `rolling-back`, `rolled-back`, `interrupted`, and `recovery-required`.

Every run has a 0600 atomic JSON journal. Each step records its status, mutation flag, evidence, errors, and completion boundary. The journal hash excludes only its own hash field, is recalculated on every write, and is checked before progress, resume, rollback, or final-report reads. Journal writes validate the central transition graph; an interrupted partial live swap becomes `recovery-required` and cannot be auto-resumed.

## Dry run and preflight

`dryRunOpenClawMigration` performs identity, path, version, ownership, supervisor, and state inventory checks and returns the planned mutation steps. It does not create a run directory, snapshot, target state, config, process, or package replacement.

The plan fails closed for:

- wrong source or target identity;
- a non-upgrade or invalid semantic version relation;
- missing source state or package;
- a live or unprovable state owner, detected from Gateway PID/lock markers and the configured loopback port rather than caller-supplied booleans;
- unsafe, relative, root, equal, or nested state paths;
- an external supervisor when AgentOS would need to replace the process.

An external-supervisor plan may inspect, preflight, plan, and snapshot, then remains `blocked`. It cannot replace or roll back a supervisor-owned runtime.

## Snapshot and SQLite handling

Snapshotting happens before state mutation. State files, symlinks, config, and the managed source package are retained under the run root. SQLite files are not copied as ordinary files: the source connection is opened read-only, busy timeout and `trusted_schema=OFF` are set, `VACUUM INTO` consolidates WAL content, and the destination is checked with integrity, foreign-key, user-version, journal-mode, and SHA-256 evidence. `-wal`, `-shm`, and `-journal` sidecars are recorded as source evidence and are not replayed as independent files.

OpenClaw's target database preflight is run against staged SQLite state before repair. This preserves the target's own schema and ownership checks instead of duplicating them in AgentOS. The real fixture exercises a WAL database and a legacy session/transcript shape; the target's session migration creates its own durable session migration record and imported transcript archives.

## Target migration and doctor

The target package is copied and its identity is re-read before use. AgentOS then runs the exact target commands in the isolated target environment:

1. `doctor --lint --json --no-workspace-suggestions` for read-only preflight;
2. `database preflight --json <sqlite>` for each staged database;
3. `doctor --fix --non-interactive --yes --no-workspace-suggestions` as the explicit state/config migration, with before/after manifest delta classification;
4. a second read-only doctor lint;
5. `doctor --post-upgrade --json --no-workspace-suggestions` after the target Gateway starts.

Doctor output is preserved as bounded, redacted command evidence. Structured findings and non-zero advisory lint are visible; missing machine-readable output or a failed repair blocks the run. The mutation allowlist distinguishes config, SQLite, session/transcript migration, cron, plugin/skill, generated backup, and workspace metadata changes from unexpected workspace user-file changes. AgentOS does not silently treat doctor warnings as success.

## Runtime certification and preservation

The target is started through the migration runtime adapter with loopback binding, isolated state/config paths, and a token supplied through process environment rather than command-line arguments. Certification uses the existing native WebSocket Gateway client and checks:

- exact target Gateway handshake and health;
- configured loopback model execution;
- native streaming and terminal event delivery;
- persisted assistant history and session continuity;
- Gateway restart and reconnect;
- `cron.add`, `cron.run`, and terminal `cron.runs` polling.

The preservation report compares stable agent/session/automation/model identities, workspace hashes, transcript event counts, and the core `agents`, `gateway`, and `models` config shape. OpenClaw-owned normalized fields are allowed to change; loss of stable identity, workspace content, transcript coverage, or core config shape fails the gate.

## Commit, rollback, and interrupted recovery

The staged Gateway is stopped and its stop contract is verified before any live path is changed. The guarded swap durably records package/state/config sub-phases and retains pre-commit backups. The target is then booted from the managed install against the canonical live state/config; native session history and durable session creation are checked, stale staging paths are rejected, and canonical SQLite is inspected directly plus through target `database preflight --json` (using a WAL-aware consolidated file when sidecars exist). Only then is the explicit commit point recorded. Cleanup removes disposable staging paths; the verified snapshot, journal, preservation report, and rollback package remain.

Rollback requires a verified snapshot, no live detected owner, and an AgentOS-managed supervisor. It stops the migration-owned Gateway, restores partial or complete live-swap backups, restores state/config from the snapshot, restores the source package, boots the source runtime on canonical paths, and certifies source health, history/session write, model/streaming/restart/cron, and SQLite integrity. Only a passing rollback gate records `rolled-back`; a failure remains `recovery-required`.

An interrupted run can be marked `interrupted` and resumed from its durable journal. Resume preserves completed inspect/preflight/plan/snapshot/staging/validation/migration work, discards only later volatile step completion, and re-runs target start, post-doctor, certification, preservation, commit, and cleanup. A run that already crossed the commit point cannot be resumed automatically.

## Service boundary and security

The supported application boundary is:

`operator/API -> authenticated migration service -> migration engine -> OpenClaw CLI for migration-only commands and native Gateway client for runtime certification`

The API uses AgentOS API authentication for both reads and writes, returns no-store redacted JSON, accepts only explicit non-root absolute paths, and never persists the transient Gateway token. The engine's command output, evidence, errors, and journal are redacted before persistence. No `.env*`, credential, browser-profile, cookie, or token file is created or tracked.

## Evidence and verification

The sanitized evidence artifact contains provenance, dry-run output, fixture scope, migration journal, success-gate checks, and injected-failure rollback results. It replaces disposable paths and exact package paths with placeholders and does not include external credentials.

The executable proof is:

```sh
pnpm openclaw:migration-e2e
```

The harness uses an exact disposable `2026.6.11` package, a loopback model provider fixture, real source Gateway seeding, real target doctor/state migration, native target certification, and a deterministic runtime-certification failure followed by rollback. It cleans the fixture root unless `OPENCLAW_MIGRATION_KEEP_FIXTURE=1` is explicitly set for local diagnosis.

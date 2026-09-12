# AgentOS 0.7.9 Release Notes

AgentOS 0.7.9 is a compatibility and certification release for OpenClaw
2026.9.4. It is not a major AgentOS product feature release.

## Highlights

- Promotes OpenClaw 2026.9.4 as the recommended and native certified contract.
- Pins the official Gateway client and protocol packages to 2026.9.4.
- Pins the Railway image to the verified OpenClaw 2026.9.4 multi-architecture
  digest without changing Railway state or deploying infrastructure.
- Adds exact-source contract audit and disposable 2026.9.3 → 2026.9.4 migration evidence.
- Preserves OpenClaw-native lifecycle, updater, recovery, identity, session,
  provider, channel, plugin, memory, automation, Doctor, and Human Control ownership.

## OpenClaw Compatibility Impact

OpenClaw Gateway protocol remains v4. State schema migration 16 → 17 and
agent schema 19 were proven with real 2026.9.3 and 2026.9.4 packages in an
isolated runtime. OpenClaw 2026.9.1 remains the supported baseline.

Exact target source commit: `3a9d69db306cd7f081e06254cb89c4bcc14a7107`. See
[`openclaw-2026.9.4-compatibility-audit.md`](openclaw-2026.9.4-compatibility-audit.md)
for the complete identity and certification matrix.

## Security Impact

No security-sensitive defaults were weakened. Native OpenClaw authorization,
identity, scope, ownership, backup, update, and rollback semantics remain
authoritative. `OPENCLAW_CONFIG_READONLY=1` was analyzed but is not enabled
globally.

## Validation

- Current phase exact upstream contract audit: PASS; package integrity, signed
  tag identity, protocol v4, schema 16 → 17, and additive contract checks all
  passed.
- Current phase disposable 9.3 → 9.4 migration: PASS; representative state,
  reconnect, security policy, native surfaces, and idempotent recovery passed.
- Current phase exact-package runtime certification: PASS; 60 PASS, 0 FAIL,
  12 SKIPPED, 13 EXPECTED-DENIAL, 0 UNKNOWN, and migration readiness is true.
- Current phase native Doctor/update/recovery hardening: PASS; update.run and
  gateway.restart.request remain intentionally SKIPPED because they can mutate
  an installation or terminate the disposable Gateway.
- The pre-existing 9.4 certification artifacts remain immutable historical
  evidence. Current Phase 1 provenance is recorded in the four
  `openclaw-2026.9.4-agentos-seven-phase-*.json` artifacts.
- Optional observations remain explicitly `SKIPPED` where the exact runtime
  did not advertise a surface; expected authorization denials remain denials.

## Smoke Status

The existing 9.4 evidence set records passing disposable checks for official
Gateway transport, fresh baseline, lifecycle, identity, multi-user,
session/task, workforce, models/providers, channels/accounts, skills/plugins,
memory, automation/cron, Human Control, Doctor, native work, and updater
recovery. Those artifacts retain their earlier AgentOS provenance; this phase
does not overwrite them and reports only the current contract, migration,
runtime, and Doctor gates in the new phase-specific evidence.

## Known Limitations

- Railway remains undeployed and unmutated; the repository pin now targets the
  verified OpenClaw 2026.9.4 multi-architecture index.
- No live third-party provider credentials or channel login was exercised.
- Live `update.run` and `gateway.restart.request` were not executed; their
  native mutation and reconnect verification remain explicit operator/runtime
  operations, not AgentOS-owned lifecycle behavior.
- A prior macOS native updater symlink-swap failure was not retried. It remains
  separate from this Linux Railway image pin and must be resolved upstream
  before claiming a successful native macOS installation update.
- New 9.4 plugin catalog, prepared worker/session UX, task-history UI,
  delegated Talk completion, and terminal question UI remain deferred.

## Upgrade Notes

Use the existing AgentOS installation and native OpenClaw update/recovery
workflow. Migration-bearing updates must retain verified backup protection.
AgentOS does not own rollback or schema migration. For local certification,
use the repository's exact-package migration script and never point it at a
developer or production OpenClaw state directory.

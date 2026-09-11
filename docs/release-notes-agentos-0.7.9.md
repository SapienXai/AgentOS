# AgentOS 0.7.9 Release Notes

AgentOS 0.7.9 is a compatibility and certification release for OpenClaw
2026.9.4. It is not a major AgentOS product feature release.

## Highlights

- Promotes OpenClaw 2026.9.4 as the recommended and native certified contract.
- Pins the official Gateway client and protocol packages to 2026.9.4.
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

- Exact upstream contract audit: PASS.
- Disposable 9.3 → 9.4 migration: PASS.
- Final 9.4 certification aggregation: PASS; 20 artifact gates passed,
  0 failed, 0 required gates environment-limited.
- Optional observations remain explicitly `SKIPPED` where the exact runtime
  did not advertise a surface; expected authorization denials remain denials.

## Smoke Status

Official Gateway transport, fresh baseline, lifecycle, identity, multi-user,
session/task, workforce, models/providers, channels/accounts, skills/plugins,
memory, automation/cron, Human Control, Doctor, native work, and updater
recovery evidence passed in disposable local runtimes.

## Known Limitations

- The Railway deployment remains pinned to OpenClaw 2026.9.3; no production
  infrastructure was changed in this local-only preparation.
- No live third-party provider credentials or channel login was exercised.
- New 9.4 plugin catalog, prepared worker/session UX, task-history UI,
  delegated Talk completion, and terminal question UI remain deferred.

## Upgrade Notes

Use the existing AgentOS installation and native OpenClaw update/recovery
workflow. Migration-bearing updates must retain verified backup protection.
AgentOS does not own rollback or schema migration. For local certification,
use the repository's exact-package migration script and never point it at a
developer or production OpenClaw state directory.


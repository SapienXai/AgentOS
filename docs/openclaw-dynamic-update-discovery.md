# Dynamic OpenClaw update discovery

## Ownership decision

Operators should see the current release on their configured channel and install
it from Updates. OpenClaw owns registry selection, installation, migrations,
restart, durable run history and recovery. AgentOS owns the availability
projection, authenticated confirmation, compatibility policy and verification UI.

## Observed contract

The installed OpenClaw 2026.10.6 Gateway caches package availability.
`src/gateway/server-methods/update-status.ts` returns `getUpdateAvailable()`;
`src/infra/update-status-schedule.ts` refreshes only dev/immutable installations
when `refreshCheckout` is requested. Refreshing stable package status therefore
does not necessarily refresh registry availability. The observed Gateway target
was 2026.10.8 while `openclaw update status --json` reported 2026.10.9.

`update.run` remains the native mutation. Its package path resolves the current
configured channel; the RPC only supports explicit Git targets, not an exact
package version parameter. AgentOS must not pretend a displayed package version
is an upstream package pin. A changed version after restart is verified against
the confirmed expectation; an unexpected result remains unknown.

## Integration

- Read native status, active run, campaign, channel and authorization first.
- Use the existing explicit read-only `getUpdateStatus` fallback for fresh package
  availability. No AgentOS registry selector or shell updater is introduced.
- Admit local package discovery only when the trusted client and CLI configuration
  have matching local endpoint, state root, config path and profile, and the
  reported channel matches the native channel. This is read-only discovery
  evidence, never mutation authority.
- Preserve native campaign targets and active runs. Remote/unproven configurations
  retain their native target and cannot promote local CLI discovery.
- If a local package requires fresh discovery but discovery fails, block update
  admission and provide Refresh as recovery rather than install a stale target.
- Keep `updates.manage`, authenticated native admin scope, healthy/applied config,
  compatibility decisions, informed confirmation, identity/generation binding,
  single-use actor-bound challenges and serialized update admission.
- Recheck availability before mutation, including after security preflight.
- Execute `update.run`, then reconcile durable run history, reconnection, running
  version and runtime health. A successful request alone is not update success.
- Refresh the visible Updates page every minute and on window focus, pausing
  background checks while confirmation or update verification is active.

The installed runtime remains 2026.10.6; the certified recommendation remains
2026.9.7 and supported minimum 2026.9.1. Discovering 2026.10.9 does not certify it.
Contract tests cover channel/locality isolation, campaign preservation, failed
freshness checks, authorization, informed confirmation and stale confirmation.

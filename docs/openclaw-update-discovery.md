# OpenClaw update discovery and execution boundary

AgentOS presents OpenClaw updates through one product-level projection shared by
the Settings runtime row, Mission Control, and the canonical Updates page.

## Source of truth

OpenClaw's Gateway `update.status` remains authoritative for the installed
runtime, channel, native update target, active run, and last run. A native
`update.run` is the only normal update mutation exposed by AgentOS.

When a connected Gateway omits the exact native target but the runtime's
OpenClaw adapter can obtain a target through its existing status fallback,
AgentOS may show that target as `available-fallback`. This is an explicit,
read-only discovery path. It never produces a native confirmation and never
enables the normal `update.run` action. The operator is directed to the
advanced in-app tools until the Gateway exposes the native target.

Availability and compatibility are intentionally separate:

- an available target is shown even when it is uncertified or policy-blocked;
- AgentOS certification decides whether the normal native action is enabled;
- an AgentOS prerequisite is shown as an AgentOS update requirement;
- unknown, unavailable, held, and running states remain honest projections of
  the native runtime.

## Compatibility manifest inputs

The shipped local compatibility manifest is always retained. An explicit local
Compatibility Lab override may replace the decision for a matching version,
but it cannot erase newer shipped release entries. The effective manifest is
the union of shipped and explicit local entries, with same-version operator
decisions taking precedence.

No unsigned or unauthenticated remote manifest is currently accepted as an
update-safety input. A future remote source must define authenticated
transport, integrity verification, freshness/replay handling, and a safe
failure mode before it can affect normal update eligibility. Remote failure
must therefore leave the shipped local policy intact rather than silently
unlocking or hiding a target.

## Ownership boundary

OpenClaw owns updater phases, restart/service handoff, backup protection,
rollback, recovery, and runtime persistence. AgentOS performs compatibility and
security preflight, sends the native mutation, reconnects, and reports the
native terminal outcome. AgentOS does not maintain a second updater ledger or
rollback state machine.

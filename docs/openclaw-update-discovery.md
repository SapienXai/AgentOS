# OpenClaw update discovery and execution boundary

AgentOS presents OpenClaw updates through one product-level projection shared by
the Settings runtime row, Mission Control, and the canonical Updates page.

## Source of truth and ownership

OpenClaw's connected Gateway `update.status` is authoritative for the installed
runtime, effective channel, exact native target, active update campaign, and
last run. OpenClaw owns update discovery and execution, migrations, backup,
restart, rollback, and recovery. AgentOS does not install packages through a
shell command or maintain another updater state machine.

AgentOS owns compatibility intelligence, authorization-aware presentation,
safety preflight, informed confirmation, orchestration of the native call,
reconnect, and post-update verification. `update.run` is the only normal update
mutation exposed by AgentOS.

## Compatibility confidence and native eligibility

The compatibility manifest records exact releases AgentOS verified, releases
known to be incompatible, minimum AgentOS requirements, notes, and the tested
recommendation. Certification answers whether AgentOS explicitly tested that
exact OpenClaw release. It is not a universal install allowlist.

An exact stable release missing from the manifest is **not yet verified**. Its
absence alone does not deny a normal update. A stable or extended-stable target
may use the normal native path when all of these current facts are established:

- the connected Gateway reports `updateAvailable: true` and the exact target;
- the target is a valid stable OpenClaw date-version newer than the installed
  version, and the effective channel is stable or extended-stable;
- the acting AgentOS user has `updates.manage`, and the authenticated Gateway
  identity has known scopes including native `operator.admin`;
- native health, status, configuration validity/application, and recovery
  preflight are available and healthy;
- the target is not explicitly blocked and does not require a newer AgentOS;
- the Gateway is not already updating or holding the campaign; and
- an unverified target has a fresh, informed confirmation.

An exact certified target follows the normal confirmation flow without the
additional unverified-release acknowledgment. For an unverified target, the
Updates page says that it has not yet been verified by AgentOS and asks the user
to confirm before sending `update.run`. AgentOS does not describe it as safe,
fully compatible, or certified.

The server recomputes native status, compatibility policy, authorization,
preflight, and confirmation immediately before `update.run`. Confirmation is
bound to Gateway connection and generation, current and target versions,
channel, update availability/source, authorization evidence, configuration and
recovery state, AgentOS version, and compatibility decision. A changed fact
requires a refreshed confirmation. Normal update confirmation also carries a
short-lived, server-issued challenge bound to the authenticated AgentOS actor;
the server consumes it once immediately before the native mutation, so the same
confirmation cannot be replayed.

An explicit known-incompatible decision, an unmet AgentOS minimum, unknown
runtime/channel/target facts, insufficient authorization, an unsupported
channel, an active or held update, or failed required preflight blocks the
normal path. A read-only CLI fallback may inform the user that an update exists,
but it cannot provide the exact native target required for normal execution.

## Native update path and verification

The normal path is:

```text
fresh Gateway update.status
  → AgentOS compatibility and safety policy
  → AgentOS and native authorization checks
  → fresh informed confirmation when unverified
  → fresh server-side policy evaluation
  → Gateway update.run
  → OpenClaw updater, migration, backup, restart, and recovery lifecycle
  → Gateway reconnect
  → fresh runtime and capability verification
```

An accepted RPC, HTTP success, or Gateway disconnect does not prove the update
completed. AgentOS waits for a fresh authenticated Gateway generation and
verifies usable health, the exact installed target, terminal/current native
update state, applied interpretable configuration, known authorization, required
Gateway/session capabilities, and absence of recovery or rollback activity. If
that truth cannot be established, the result remains **verification required**
or **unknown**. AgentOS never blindly retries an ambiguous `update.run` call.

## User-facing states

The Updates page distinguishes up to date, update available and verified,
update available but not yet verified, AgentOS update required, known
incompatible, update in progress, update held by OpenClaw, native update
unavailable, verification required, and unknown. A verified or eligible
unverified native target uses the normal **Update OpenClaw** action. An
unverified target includes the confirmation warning above; known blockers show
their reason and next step.

Community release intelligence is an advisory signal only. It never supplies
installed-version truth, channel truth, native availability, or an update
target.

## Capability-driven forward compatibility

`OPENCLAW_RECOMMENDED_VERSION` means the release AgentOS most recently tested
and recommends. It is not the maximum OpenClaw version AgentOS may run. Runtime
health follows native health and the capabilities AgentOS actually needs. A
newer version with required capabilities intact remains healthy; a missing
optional capability affects the dependent feature; a missing required
capability reports a compatibility issue for the affected operation.

## Compatibility manifest and release watcher

The shipped manifest remains in force, and explicit local Compatibility Lab
decisions can update a matching version without erasing newer shipped entries.
Remote manifests are not accepted as safety inputs until authenticated and
integrity-verified. A missing exact entry is represented as not yet verified;
only explicit blocked evidence or a minimum-AgentOS requirement blocks the
normal update for compatibility reasons.

The read-only release watcher still discovers stable releases, verifies
upstream identity, compares Gateway contracts, captures release evidence, and
opens compatibility review. It does not certify, promote a manifest entry,
change version policy, or mutate a Gateway. Watcher completion is not a
prerequisite for an authorized user to use OpenClaw's native updater when no
known blocker exists.

The advanced Compatibility Lab remains the place for exact-version probes,
review, certification, and promotion. Those tools do not replace the normal
OpenClaw-native update path.

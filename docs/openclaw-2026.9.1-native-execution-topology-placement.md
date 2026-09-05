# AgentOS and OpenClaw 2026.9.1 Native Execution Topology and Placement

This document records the Phase 8 execution-topology boundary for the pinned
OpenClaw `2026.9.1` runtime (`ad6fe23aecb9b833d68139b0ddc9f239b894d2f1`).
OpenClaw remains the execution authority. AgentOS projects native facts,
applies product authorization, routes typed actions, and audits the operator
request.

## Ownership boundary

OpenClaw owns node identity and pairing, environment inventory and lifecycle,
session-host eligibility, worker profiles and slots, capacity, placement
selection, dispatch, move, reclaim, and cloud-worker provisioning. AgentOS
does not persist a competing node, environment, capacity, placement, lease,
or worker lifecycle database.

The canonical read is native `environments.list`. The Gateway-local
environment is preserved as a real native environment; paired nodes and cloud
worker environments remain distinct native records. `node.list` and
`node.describe` are bounded diagnostic/detail reads and are not a second
product inventory.

Native environment IDs are preserved. A read failure is projected as
`unknown` or `unavailable`, never as an authoritative empty inventory. A
partial detail failure does not discard a valid inventory. Native display
names, issue text, capabilities, and host statistics are data and are not
treated as instructions.

## Environment and node truth

An execution destination is eligible only when native evidence says that it
is a session host and the normalized native state is currently available.
Worker environments additionally require a native worker state of `ready`,
`attached`, or `idle`. Connection alone is not session-host eligibility, and
last-seen information is not current connectivity.

AgentOS preserves native status, platform, trust, capabilities, invocable
command metadata, worker slots, worker bundle, attached sessions, issues, and
last-seen facts where present. It does not infer health, capacity usage, or
provider readiness from unrelated fields.

There is no generic `node.invoke` UI. The native method remains a typed,
dynamic-authorization boundary for future feature-specific integrations.
Pairing operations remain the existing OpenClaw-owned advanced surface;
pairing is not treated as equivalent to an eligible execution environment.

## Current placement and destinations

Selected-session placement is read from native session placement metadata when
available. The native `execNode` hint is retained only as a location hint when
the richer placement object is absent; it is not upgraded into a fabricated
lifecycle state. Requested destination and actual current placement are kept
separate. Acceptance of a dispatch or move request does not mean the session
is already running there; AgentOS waits for a native reread.

`Automatic` is sent as native `sessions.dispatch` with `autoDevice: true` and
is presented as **Automatic — OpenClaw managed**. AgentOS performs no ranking,
load balancing, least-loaded selection, round-robin choice, or scheduler
logic. Specific device, worker-profile, and gateway move targets are sent
only through the exact native payloads supported by OpenClaw 2026.9.1.

The selected-session execution inspector is the product surface for current
location and authorized placement changes. The topology picker is lazy; the
root Dashboard does not read environments, nodes, or placement. A native
environment that becomes unavailable after picker load can still be rejected
by the Gateway, and that rejection remains visible to the operator.

## Native actions

The native-only application service routes:

- `sessions.dispatch` for automatic, device, and configured worker-profile
  dispatch;
- `sessions.move` with native generation, environment, and owner-epoch
  expectations;
- `sessions.reclaim` as an advanced native recovery action;
- `environments.create` and `environments.destroy` when the exact methods are
  advertised and the product lifecycle permission is present.

`environments.create` uses the native profile ID and a server-generated native
idempotency key. AgentOS does not invoke a cloud SDK, allocate a VM, bootstrap
SSH, register a node, or maintain worker leases. `environments.destroy` is
explicitly confirmed, validates the native target type, and never exposes the
Gateway-local environment as a destroy target. Node pairing removal and worker
environment destruction remain separate operations.

The browser supplies only a requested target. The server resolves the current
AgentOS actor, checks product permission, performs native scope/dynamic
authorization preflight, validates the live native target where possible, and
then calls the official Gateway client. OpenClaw remains final authority.

## Mutation truthfulness

All placement and environment mutations use the existing shared native
mutation classifier and execution helper. A definite native rejection is
`failed` and is never reconciled from a matching state. An ambiguous delivery
is not retried. AgentOS performs at most one bounded authoritative reread and
returns reconciled success only when the post-state proves a transition from
the captured pre-state. If causality cannot be proven, the outcome is
`unknown`, with `retryable: false` and neutral uncertainty wording.

This preserves the Phase 7.1 rule for dispatch, move, reclaim, create, and
destroy. Native success does not require a speculative verification read; the
ambiguous path is the only reconciliation path. Privileged operations are
audited with the AgentOS actor, safe target, requested operation, result, and
timestamp. Credentials, provider payloads, private keys, tunnel details, and
raw Gateway errors are not persisted.

## Authorization and events

The exact 2026.9.1 static scopes used here are:

| Native method | Scope |
| --- | --- |
| `node.list`, `node.describe` | `operator.read` |
| `environments.list`, `environments.status` | `operator.read` |
| `environments.create`, `environments.destroy` | `operator.admin` |
| `sessions.reclaim` | `operator.write` |
| `sessions.dispatch`, `sessions.move`, `node.invoke` | dynamic native authorization |

Placement mutations require the narrow AgentOS `sessions.place` permission,
which is owner-only in the current shared-service policy. Environment
creation/destruction uses the existing owner-level `lifecycle.manage`
permission. Product policy runs before the shared Gateway transport; native
scope and target authorization remain final.

Topology and selected-session freshness reuse the existing AgentOS event
bridge and stream. Relevant native node/session events invalidate the bounded
projection. There is no new EventSource, Gateway subscription, reconnect
owner, heartbeat, or polling loop. Detail requests are fenced to their
selected environment or session so late responses cannot overwrite a newer
selection.

## Performance and limits

The root Dashboard adds zero environment, node, or placement reads. The
initial topology view uses one `environments.list`; selected environment/node
detail adds at most one corresponding native detail read. It does not call
`node.describe` for every environment and does not read placement per session
in list views. Destination validation reuses one bounded environment/profile
inventory, and mutation reconciliation uses at most one authoritative reread.

The current certification uses exact package/descriptor evidence and
deterministic native Gateway fixtures. No safe disposable paired session-host
node, second placement target, or configured zero-risk cloud provider is
assumed. Therefore live external-node dispatch/move and cloud create/destroy
may remain skipped; such skips are not replaced by fake nodes, cloud records,
or user-device mutations.

# OpenClaw Native Doctor, Update, and Recovery

AgentOS presents operational OpenClaw state without becoming a second runtime or
repair engine. OpenClaw 2026.9.1 remains authoritative for health, configuration
application, updates, restart coordination, suspension, authorization, and
reconnect behavior. AgentOS normalizes those native facts for the existing
Settings, Diagnostics, Gateway, and Updates surfaces.

## Native contract

The online operational projection uses the official Gateway transport and these
2026.9.1 methods:

| Surface | Native methods | AgentOS use |
| --- | --- | --- |
| Health | `health`, `status` | Runtime reachability and status |
| Diagnostics | `diagnostics.stability` | Bounded stability evidence |
| Configuration | `config.get` | Compare `configRevisionHash` with `appliedConfigHash` |
| Updates | `update.status`, `update.run`, `update.hold` | Native availability and update lifecycle |
| Restart | `gateway.restart.request` | Safe deferred restart request |
| Suspension | `gateway.suspend.prepare`, `gateway.suspend.status`, `gateway.suspend.resume` | Cooperative host-neutral suspension |

The exact native scopes are preserved: health and diagnostics reads use
`operator.read`; `config.get` uses `operator.read`; updates use
`operator.admin`; restart uses `operator.admin`; suspension prepare and resume
use `operator.admin`, while suspension status uses `operator.read`. Gateway
authorization remains final.

## Truthful projection

Reachability is not the same as health. A successful health response with
`ok: false` is degraded; a failed read is unknown; an explicitly unsupported
native method is unavailable. A config revision is `applied` only when the two
native revision hashes match. A known mismatch is `restart-required`; missing
hash evidence is unknown. AgentOS never uses the raw `config.get.hash` as the
runtime revision hash.

`update.status` is authoritative for update availability. AgentOS does not query
npm, GitHub, package metadata, or a local installer to fill an online native
status response. Native `update.run` remains OpenClaw's installer, supervisor
handoff, restart, and sentinel workflow. AgentOS sends only bounded, explicitly
confirmed requests and never retries an ambiguous mutation blindly.

The normal Doctor read uses native `health`, `status`, `diagnostics.stability`,
`config.get`, and `update.status` in parallel. A user-requested refresh sends
`health({ probe: true })`; normal reads do not force a probe. Runtime health,
native status/version, update availability, and recovery state remain separate
projections. Recovery recommendations are deterministic and evidence-based;
AgentOS does not diagnose independently or run an automatic repair loop.

## Recovery actions

The existing Gateway controls remain in Settings. The online diagnostic action
now reads native evidence; it does not silently run `openclaw doctor --fix`.
Native restart requests preserve OpenClaw's safe deferral default. Suspension
uses the native prepare/status/resume handshake and preserves the native
`requestId`, `terminalPolicy`, `drain`, blockers, retry, and expiry semantics.

The existing lifecycle/supervisor boundary remains responsible for explicit
offline process control where a native Gateway is not serving. That compatibility
path is not an online fallback for native operational reads or mutations.

## Security and freshness

The projection returns only bounded status, revision, channel, timing, and
recovery fields. It omits config contents, commands, install roots, tokens,
credentials, and private paths. Existing AgentOS product permissions,
`AgentOsGatewayRequestPolicy`, centralized redaction, event invalidation, and
the official transport/reconnect owner remain in force.

Doctor/update/recovery reads are lazy operational-detail work. The root
Dashboard gains no new fan-out. Native events invalidate existing caches, and
the next detail read obtains current authoritative state. A rejected or
ambiguous mutation is reported honestly; AgentOS does not synthesize progress or
claim verification that the reconnecting Gateway has not provided.

## Phase 6 certification note

Phase 6 was certified against the exact OpenClaw 2026.9.1 source contract pinned
by AgentOS. Disposable live mutation proof remains explicitly marked skipped or
expected-denial when an isolated authenticated Gateway cannot safely provide the
required fixture. Contract tests and native-only transport tests cover the same
method boundaries without touching user Gateway state.

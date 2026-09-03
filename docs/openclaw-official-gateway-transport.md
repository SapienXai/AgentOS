# Official OpenClaw Gateway transport

Phase 3 extends the additive certification path for the exact OpenClaw
2026.8.2 Gateway client package:

- `@openclaw/gateway-client@2026.8.2`
- `@openclaw/gateway-protocol@2026.8.2`
- OpenClaw source commit `0965053fe6b9341776df1476a6934b7485c60b5ca`
- Gateway protocol v4

The package is pinned exactly in the root `package.json` and lockfile. The
official client is used through `OfficialOpenClawGatewayTransport`, which
keeps the AgentOS boundary narrow: metadata, explicit credentials, host
dependencies, callbacks, and error classification. WebSocket lifecycle,
challenge/connect, request correlation, timeouts, aborts, reconnect, event
delivery, sequence-gap reporting, and device-auth protocol behavior remain
owned by the official package.

## Ownership split

`OfficialOpenClawGatewayTransport` is the sole socket, reconnect, request, and
handshake owner on the official path. AgentOS does not add a second WebSocket,
request-correlation layer, or reconnect timer there.

`OfficialOpenClawGatewayConnectionCoordinator` is the AgentOS compatibility
layer above that transport. It owns aggregate runtime subscription intent,
replay after each official `hello-ok`, generation fencing, normalized
diagnostics, and event-bridge reconciliation. The coordinator uses OpenClaw's
upstream `GatewaySessionMessageSubscriptionCoordinator` for per-session-key
`sessions.messages.subscribe` leases, so shared wire subscriptions and
release/acquire races remain aligned with the official implementation. Runtime
intent may include tasks, but AgentOS never sends a `tasks.subscribe` method.

## Host-state boundary

`createAgentOsGatewayClientHostDeps` is the AgentOS host adapter. Identity reads
are validated against the Ed25519 public-key fingerprint and never create an
identity. When the canonical OpenClaw state database exists, the adapter reads
and explicitly managed writes use `state/openclaw.sqlite` and the official
`device_identities` / `device_auth_tokens` tables. The legacy JSON files are
only a compatibility fallback for older fixtures where the canonical database
does not exist.

The default `sharedStateMode: "read-only"` mode cannot rotate or clear shared
device tokens. `sharedStateMode: "managed-write"` is an explicit opt-in for
the official client’s token-rotation callbacks. SQLite mutations use an
immediate transaction and compare the token observed by that host before
updating or deleting it; stale writers become no-ops. The legacy fixture path
uses the same expected-token fence with a narrow lock file and atomic rename.
Log redaction is enforced at this host boundary so credentials, bearer values,
private keys, and secret query parameters do not enter the official client’s
diagnostic callbacks.

Credential precedence remains the official helper’s precedence: a preferred
bootstrap token is selected first; otherwise an explicit token wins, an
explicit device token is used when provided, stored device auth is used when
no token/password is supplied (or only for the official trusted retry path),
and password remains explicit. AgentOS does not silently replace an explicit
token or password with stored device auth.

## Event bridge and recovery

The official-backed event bridge reports the official lifecycle state directly.
It replays the aggregate `sessions.subscribe` intent and the per-key message
leases after reconnect, handles release/acquire races during reconnect, and
does not start the custom AgentOS reconnect timer. The custom transport keeps
its existing timer because it remains the lifecycle owner on that path.

Sequence gaps and reconnects trigger a bounded, coalesced reconciliation of
`sessions.list` and `tasks.list` with five-second request bounds. At most two
passes are made per reconciliation window, and the status projection exposes
the last gap, expected/received sequence values, reconciliation state, and
last successful reconciliation time. Stale reconciliation work is ignored
after the bridge is reset.

## Production selection

The production factory intentionally continues to return AgentOS's custom
`NativeWsOpenClawGatewayClient` with its existing CLI fallback policy. The
official transport is not wired into the default factory in Phase 3. Existing
application services, normalizers, caching/coalescing, diagnostics, auth
attribution, runtime projection, and orchestration behavior therefore retain
their current production path. Phase 4 owns the explicit cutover decision.

## Certification coverage

`tests/openclaw-official-gateway-transport.test.ts` uses a real local
`ws.WebSocketServer` harness for protocol behavior, signatures, token rotation,
and read-only/managed-write state safety. The coordinator and event-bridge
tests cover official lifecycle ownership, exact reconnect replay, per-key
lease races, no `tasks.subscribe`, event delivery, sequence-gap reporting,
bounded reconciliation, canonical SQLite state, stale-token fencing, and log
redaction.

The exact-runtime certification runs against a disposable OpenClaw 2026.8.2
Gateway process and writes a sanitized evidence artifact:

```sh
OPENCLAW_OFFICIAL_LIFECYCLE_PACKAGE=/path/to/exact/openclaw/package \
  pnpm openclaw:official-lifecycle-cert
```

The Phase 3 gate passed with the exact package/source commit, official v4
handshake, canonical device identity/token state, official-backed domain
reads, reconnect after an isolated Gateway restart, and no parallel reconnect
owner. Evidence is recorded in
`docs/evidence/openclaw-2026.8.2-official-gateway-lifecycle-certification.json`.

## Intentionally unchanged

There is no Phase 4 production cutover, no removal of the custom transport or
CLI fallback, no UI change, no new AgentOS runtime/orchestrator, and no
publishing, release, push, or deployment in this phase.

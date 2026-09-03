# Official OpenClaw Gateway transport

Phase 4 makes the official-backed client the production default for the exact OpenClaw
2026.8.2 Gateway client package:

- `@openclaw/gateway-client@2026.8.2`
- `@openclaw/gateway-protocol@2026.8.2`
- OpenClaw source commit `0965053fe6b9341776df147a6934b7485c60b5ca`
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

The `AgentOsGatewayRequestPolicy` is the shared AgentOS policy layer above
both the custom and official transport boundaries. It owns the 300 ms read
projection cache, deterministic method/parameter cache identity, identical
read coalescing, mutation invalidation, lifecycle/generation cleanup, and
truthful cache/coalescing diagnostics. Neither Gateway transport nor the
official package contains this AgentOS policy.

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

The production factory returns the existing AgentOS
`NativeWsOpenClawGatewayClient` domain/policy layer with the official Gateway
transport by default. Existing application services, normalizers, request
policy, diagnostics, auth attribution, runtime projection, and orchestration
behavior remain above the transport boundary.

The server-side migration selector is `AGENTOS_OPENCLAW_TRANSPORT`:

- unset or `official`: official-backed production transport;
- `custom`: explicit bounded rollback to the legacy custom transport;
- any other value: fail closed to the official transport and expose a safe
  diagnostic warning.

`AGENTOS_OPENCLAW_GATEWAY_CLIENT=cli`, `OPENCLAW_GATEWAY_CLIENT=cli`, and
`AGENTOS_OPENCLAW_NATIVE_WS=0|false|off` remain the explicit CLI-only override.
CLI is an AgentOS policy fallback/recovery path, not an automatic transport
rollback. The custom transport remains temporarily available for migration
rollback and is not exposed in normal user UI.

Normal official production clients use `sharedStateMode: "managed-write"` so
the official package can persist and clear rotated device tokens through the
AgentOS host adapter's fenced canonical OpenClaw state boundary. Explicit
token/password environment inputs retain their credential behavior, and the
official host's debug/error hooks remain redacted/no-op because AgentOS already
projects sanitized lifecycle diagnostics.

## Certification coverage

`tests/openclaw-official-gateway-transport.test.ts` uses a real local
`ws.WebSocketServer` harness for protocol behavior, signatures, token rotation,
and read-only/managed-write state safety. The coordinator and event-bridge
tests cover official lifecycle ownership, exact reconnect replay, per-key
lease races, no `tasks.subscribe`, event delivery, sequence-gap reporting,
bounded reconciliation, canonical SQLite state, stale-token fencing, and log
redaction.

The Phase 4 exact-runtime certification runs against a disposable OpenClaw
2026.8.2 Gateway process through the true production factory and writes a
sanitized evidence artifact:

```sh
OPENCLAW_OFFICIAL_PRODUCTION_PACKAGE=/path/to/exact/openclaw/package \
  pnpm openclaw:official-production-cert
```

The gate checks the exact package/source commit, official v4 handshake,
canonical device identity/token state, the default and explicit selector
paths, core Gateway reads, reconnect after an isolated Gateway restart,
subscription replay, request-policy continuity, custom rollback, forced CLI,
and invalid-selector fail-closed behavior. Evidence is recorded in
`docs/evidence/openclaw-2026.8.2-production-cutover-certification.json`.
Authoritative runs require a clean worktree and capture `agentosHead`,
`certifiedCodeHead`, `branch`, `workingTreeClean`, and the repository dirty-file
count before exercising the runtime. The certification also verifies that the
captured code HEAD does not change during the run. Because an evidence file
cannot contain the hash of the commit that contains itself, `certifiedCodeHead`
identifies the exact code revision executed; the later commit that stores the
resulting evidence is reported separately as the evidence commit.
The earlier Phase 3 lifecycle evidence remains recorded in
`docs/evidence/openclaw-2026.8.2-official-gateway-lifecycle-certification.json`.

## Intentionally unchanged

The Phase 4 cutover does not remove the custom transport, custom tests, or CLI
fallback. It does not add UI, a new AgentOS runtime/orchestrator, Phase 5
cleanup, publishing, release, push, or deployment. Legacy transport cleanup is
reserved for Phase 5 after the rollback window and architecture-lock review.

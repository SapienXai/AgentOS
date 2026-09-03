# Official OpenClaw Gateway transport

Phase 2 adds an additive certification path for the exact OpenClaw 2026.8.2
Gateway client package:

- `@openclaw/gateway-client@2026.8.2`
- `@openclaw/gateway-protocol@2026.8.2`
- OpenClaw source commit `0965053fe6b9341776df147a6934b7485c60b5ca`
- Gateway protocol v4

The package is pinned exactly in the root `package.json` and lockfile. The
official client is used through
`OfficialOpenClawGatewayTransport`, which keeps the AgentOS boundary narrow:
metadata, explicit credentials, host dependencies, callbacks, and error
classification. WebSocket lifecycle, challenge/connect, request correlation,
timeouts, aborts, reconnect, event delivery, sequence-gap reporting, and
device-auth protocol behavior remain owned by the official package.

## Host-state boundary

`createAgentOsGatewayClientHostDeps` is the AgentOS host adapter. It reads
existing OpenClaw identity and device-token state from the configured state
directory and reuses AgentOS's already-certified signing helpers. Its
`sharedStateMode: "read-only"` mode never creates an identity, stores a token,
or clears a token. Phase 2 does not add a new credential-selection policy;
callers provide explicit token/password/device-token inputs when they need
deterministic auth behavior.

## Production selection

The production factory intentionally continues to return AgentOS's custom
`NativeWsOpenClawGatewayClient` (with its existing CLI fallback policy). The
official transport is not wired into the default factory in Phase 2, so the
existing application service, normalizers, caching/coalescing, diagnostics,
auth attribution, runtime projection, and orchestration behavior do not
change.

## Certification coverage

`tests/openclaw-official-gateway-transport.test.ts` uses a real local
`ws.WebSocketServer` harness. It covers the v4 handshake and metadata,
concurrent/out-of-order responses, request timeout and abort semantics,
structured errors, task/session events, sequence gaps, socket close and
reconnect, explicit stop, existing AgentOS event normalizers, password auth,
and read-only state safety. The exact-runtime certification script provides a
separate path for testing the official transport against an isolated
OpenClaw 2026.8.2 Gateway process.

Phase 3 is intentionally not included: no production cutover, auth/reconnect
ownership migration, event-bridge migration, gap reconciliation, UI changes,
or legacy transport removal is part of this change.

# OpenClaw 2026.8.1 Lifecycle and Supervisor

> Historical 2026.8.1 artifact. The active certified AgentOS baseline is OpenClaw 2026.8.2; see [the current model/provider architecture](openclaw-2026.8.2-model-provider-architecture.md).

This document defines the single AgentOS lifecycle boundary for the OpenClaw
Gateway. AgentOS owns operator intent, normalized state, readiness evidence, and
coordination. OpenClaw owns Gateway protocol behavior and the external supervisor
owns the operating-system process when that mode is selected.

The implementation is centered on `OpenClawLifecycleService` in
`lib/openclaw/lifecycle/service.ts`. Runtime discovery is server-side and lives in
`lib/openclaw/lifecycle/runtime-discovery.ts`; external control is restricted to
`lib/openclaw/lifecycle/supervisor-ipc.ts`.

## Ownership Model

The canonical ownership values are:

- `agentos-managed`: AgentOS may own and control a direct child, or delegate to
  the existing OpenClaw host-service adapter for a local service-owned install.
- `external-supervisor`: another process manager owns the Gateway OS process.
  AgentOS can only request `status`, `start`, `stop`, or `restart` through the
  private supervisor contract.
- `unavailable`: the deployment has no supported lifecycle owner.
- `unknown`: ownership evidence is unsafe or contradictory. Mutations fail
  closed; read-only inspection may still return the reason.

An offline Gateway does not change ownership. Railway remains
`external-supervisor` even when its supervisor socket or Gateway is unavailable.

## Lifecycle State Model

Ownership and state are separate. The bounded state set is:

`unknown`, `stopped`, `starting`, `running`, `ready`, `degraded`, `restarting`,
`stopping`, `crashed`, `recovering`, and `blocked`.

`running` means process/supervisor liveness evidence exists. `ready` additionally
requires authenticated native Gateway protocol evidence, the expected protocol,
the supported OpenClaw baseline, and the required health/readiness probes.
`degraded` means the owner is reachable but the required readiness contract is
not satisfied. `crashed` and `recovering` describe unexpected exits and bounded
recovery; `blocked` means the recovery budget was exhausted.

The lifecycle operations are `inspect`, `getStatus`, `start`, `stop`, `restart`,
`waitForReady`, `recover`, `prepareForMaintenance`, and
`resumeAfterMaintenance`. Each mutation is serialized by the lifecycle service.

## AgentOS-managed Runtime

The disposable and direct-child path uses the exact resolved OpenClaw binary,
canonical state/config paths, loopback URL, port, and configured authentication
environment. It tracks the child PID and generation, waits for readiness, sends
`SIGTERM` first on stop, and escalates to `SIGKILL` only after a bounded wait.

`start` probes before spawning and refuses to create a duplicate when an existing
Gateway is live but not ready. Starting an already-ready child is a no-op. A
restart stops the owned child, starts one replacement, and confirms readiness;
the returned result is not a restart acknowledgement.

For an existing local OpenClaw service install, the lifecycle service uses the
existing adapter/client boundary for the service command and then performs the
same AgentOS readiness confirmation. It does not duplicate the host service
manager or its PID/lock implementation.

## External Supervisor

`scripts/railway-supervisor.mjs` is the production entry point and imports the
shared `scripts/railway-supervisor-runtime.mjs` implementation. The runtime owns
the Gateway child and exposes only a private Unix socket at
`AGENTOS_SUPERVISOR_SOCKET_PATH`.

The protocol is version 1 and accepts only these commands:

`status`, `start`, `stop`, and `restart`.

Requests contain a bounded request ID and protocol version. Responses contain the
owner, command, state, PID, generation, Gateway URL/port, readiness hints, and a
bounded structured error when rejected. AgentOS performs the final authenticated
Gateway readiness check; supervisor status alone is not treated as authorization
or full readiness.

AgentOS never spawns, signals, kills, or replaces an externally owned Gateway.
When the supervisor is offline, lifecycle state remains external and mutation
fails with a structured retryable error. No arbitrary command, executable, PID,
filesystem path, or shell is accepted from the browser/API request.

## Railway

The Railway container model is:

```text
Railway container
├── AgentOS application
└── railway-supervisor.mjs
    └── OpenClaw Gateway 2026.8.1
```

Gateway state remains on the persistent OpenClaw volume, AgentOS state remains on
the AgentOS volume, and the Gateway listens on container loopback. AgentOS uses
the lifecycle service for status and lifecycle requests; the supervisor remains
the process owner during Gateway downtime and AgentOS shutdown.

## Restart Semantics

OpenClaw 2026.8.1 documents `gateway.restart.request` as the current control-plane
restart operation; `gateway.restart.preflight` is a deprecated read-only preview.
The OpenClaw restart path coalesces guarded work, applies bounded drain/force
behavior, and confirms the next health/readiness state. AgentOS does not recreate
that internal restart implementation. Its lifecycle result is complete only after
the owner action, a fresh native handshake, the expected runtime check, and
readiness succeed.

In external mode, AgentOS sends `restart` to the external supervisor. The
supervisor performs the process replacement under its ownership, then AgentOS
reconnects to the new Gateway and verifies readiness. The disposable E2E records
the generation change and a fresh native connection.

The exact OpenClaw 2026.8.1 reference material used for this boundary is:

- `docs/cli/gateway.md`: install identity, external supervisors, and lifecycle
  behavior;
- `docs/gateway/protocol.md`: `gateway.restart.request`, suspension, and update
  control-plane contracts;
- `docs/gateway/health.md`: `/healthz`, `/startupz`, and `/readyz` meanings;
- `docs/gateway/restart-recovery.md`: durable restart recovery and bounded resume;
- `docs/cli/doctor.md`: `OPENCLAW_SERVICE_REPAIR_POLICY=external` behavior;
- `docs/cli/update.md`: managed-service update handoff and post-update checks.

The corresponding source locations reviewed for restart behavior include
`src/infra/restart.ts`, `src/cli/gateway-cli/run-loop.ts`,
`src/gateway/server-reload-handlers.ts`, and
`src/agents/tools/gateway-tool.ts`.

## Crash Recovery

The external supervisor monitors Gateway liveness with a bounded failure
threshold. An unexpected exit or repeated liveness failure transitions through
recovery, applies bounded backoff, and starts at most the configured recovery
limit before entering `blocked`. Graceful stop/restart is excluded from crash
recovery by clearing the owned child reference before signaling it.

The AgentOS-managed service has the same bounded recovery intent and never runs
an infinite restart loop. Unexpected child exits are observed by the lifecycle
service; recovery uses the same owner and readiness contract.

## Readiness

AgentOS readiness requires all of the following:

1. the Gateway liveness endpoint responds;
2. the Gateway `/readyz` endpoint responds;
3. a native authenticated WebSocket handshake succeeds;
4. the negotiated Gateway protocol is reported;
5. the Gateway version is at least `OPENCLAW_SUPPORTED_BASELINE_VERSION`.

The native probe uses the existing `NativeWsOpenClawGatewayClient` and the
OpenClaw-accepted `gateway-client` client identifier. Tokens and passwords are
read only from server-side runtime environment/configuration and never returned
in the descriptor or evidence artifact.

## Maintenance / Migration Coordination

`prepareForMaintenance` records whether the Gateway was running and stops it
through the resolved owner. `resumeAfterMaintenance` starts it through the same
owner and waits for readiness. This gives update/migration code a single boundary
without rebuilding the Phase 2B migration engine.

External-supervisor runtime replacement remains deferred. AgentOS does not run
OpenClaw self-update, replace an externally owned package tree, or bypass the
Phase 2B external replacement block. OpenClaw 2026.8.1 itself refuses self-update
in external supervisor mode; the deployment owner must replace the runtime and
then use the lifecycle readiness contract.

## Security

- Supervisor IPC uses a local Unix socket, restrictive `0600` permissions, a
  protocol version, request IDs, bounded request/response sizes, and an explicit
  command allowlist.
- Runtime paths are resolved on the server and must be absolute, non-root paths.
  Browser requests cannot provide binary, PID, state, config, or socket paths.
- The supervisor uses argument-array process spawning and never accepts shell
  commands or arbitrary executable requests over IPC.
- External ownership is preserved when the supervisor is offline; AgentOS does
  not fall back to local spawning.
- Descriptors and evidence contain operational metadata only. Secrets, tokens,
  passwords, cookies, and raw model content are excluded or redacted.

## Known Limitations

- Production external runtime replacement is intentionally deferred until a
  supervisor-owned replacement contract is added and certified.
- The external supervisor status response cannot itself prove AgentOS operator
  authentication; AgentOS performs the native authenticated readiness probe.
- Host-native service-manager behavior remains delegated to OpenClaw through the
  existing adapter and is not reimplemented by AgentOS.

## Deferred Phase 4+ Work

Multi-user identity, operator profiles, user-to-scope assignment, team roles, and
OpenClaw multi-user authorization remain Phase 4 work. No lifecycle API in this
phase introduces that identity model. UI redesign and broader session/task/agent
redesign are also outside this phase.

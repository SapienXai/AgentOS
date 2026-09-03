# OpenClaw 2026.8.2 Native Architecture

Status: aligned with documented compatibility fallbacks

Validated release: OpenClaw `v2026.8.2`

Source commit: `0965053fe6b9341776df147a6934b7485c60b5ca`

## Authority model

AgentOS is the operator-facing product and orchestration layer. OpenClaw remains the authority for
Gateway state, runtime execution, agents, sessions, tasks, model availability, and native control
responses.

The production path is:

`AgentOS UI/API -> application service -> OpenClaw adapter -> persistent native WebSocket Gateway`

The CLI client is a bounded compatibility path. It is never used to bypass a native authorization
denial, and mutation fallback requires a current native authorization proof.

## Upstream contract

The exact 8.2 source confirms:

- protocol version `4`, with the control-client range `4-4`;
- `hello-ok` with required server, feature, snapshot, auth, and policy fields;
- `agents.list/create/update/delete` and typed `agent` / `system` roster entries;
- the `agent-kind` client capability for receiving system entries in the roster;
- `chat.send` as the advertised chat/control primitive;
- `chat.send.queueMode` values `steer`, `followup`, `collect`, and `interrupt`;
- `sessions.steer` as a hidden deprecated alias, not a current AgentOS application method;
- `chat.inject` as a separate non-user injection operation;
- `sessions.abort` accepting exact `key`, `runId`, `agentId`, and `clearQueued` fields;
- task methods `tasks.list`, `tasks.get`, and `tasks.cancel` only.

AgentOS derives protocol versions and client capability names from
`@openclaw/gateway-protocol@2026.8.2`. The official `@openclaw/gateway-client` package was inspected
but not adopted wholesale: the existing client carries AgentOS-specific fallback, diagnostics,
authorization-proof, and application-boundary behavior. The replacement point remains the Gateway
client factory.

## Phase 1 protocol authority

Phase 1 pins `@openclaw/gateway-protocol` to `2026.8.2`, matching OpenClaw source commit
`0965053fe6b9341776df147a6934b7485c60b5ca`. The package is the canonical authority at the native
boundary for:

- protocol versions and the exact operator/client range `4-4`;
- the closed client-id/mode registry (`gateway-client` / `backend` for AgentOS);
- official client capability names (`agent-kind` and `tool-events` only);
- response/event frame guards and their official envelope types;
- structured connect-error and Gateway-error details.

AgentOS keeps its Zod payload parsers as a normalized, additive compatibility projection. They are
not a second wire-protocol authority and do not expose the upstream TypeBox schemas through product
or UI code. AgentOS-owned policy still decides redaction, recovery, fallback eligibility, and
whether `kind: "system"` entries appear in workforce selectors.

`hello-ok.features.methods` and `features.events` are conservative discovery hints, not exhaustive
callable inventories. Native decisions distinguish explicitly advertised, known-by-contract,
unknown/not-advertised, proven-unsupported, and authorization-denied states. Omission alone never
causes CLI fallback; an authoritative native response must prove unsupported behavior. The official
`connect.challenge` timestamp is validated and used as the v3 device-auth `signedAt` value.

The retained production transport is still `NativeWsOpenClawGatewayClient` over
`PersistentOpenClawGatewayConnection`; `native-ws-gateway-wire.ts` remains the AgentOS transport
boundary. This phase intentionally does not add `@openclaw/gateway-client` or migrate reconnect,
event sequencing, or transport ownership. The next phase is **Phase 2 — Official Gateway Transport
Integration**.

## Ownership boundaries

AgentOS Workspace is a product/project concept. It owns organization, manifests, policies, UI state,
and workspace-local metadata. OpenClaw owns the runtime workspace attached to an agent. AgentOS passes
canonical workspace paths to native agent/session operations and does not collapse the two entities.

AgentOS may maintain projections and sidecars for display names, workforce organization, dispatch
correlation, browser bindings, and chat drawer rehydration. Those records are not substitutes for
OpenClaw task, session, run, transcript, or agent state.

## Agent lifecycle and roster

Native lifecycle calls are made through the adapter:

- create: `agents.create` with the closed 8.2 payload (`name`, optional `workspace`, `model`, `emoji`, `avatar`);
- update: `agents.update` with the closed native fields;
- delete: `agents.delete` by exact native `agentId`;
- list: `agents.list`, advertising `agent-kind` and preserving returned kind/provenance fields.

AgentOS filters `kind: "system"` from ordinary workforce projections while retaining native typed data
for diagnostics/runtime projections. Older responses without `kind` remain valid compatibility input;
AgentOS does not infer a kind when OpenClaw provides one.

## Sessions, chat, and control

Fresh session preparation uses native `sessions.create` where the workflow needs an explicit session,
then submits the user turn through `chat.send`. `sessions.send` is retained only as a bounded
compatibility fallback when `chat.send` is unavailable. Native response fields such as `sessionKey`,
`sessionId`, `runId`, and `messageSeq` are preserved when returned.

Direct chat, mission dispatch, and continuation all pass through the same adapter boundary. A fresh
AgentOS chat record may request an explicit OpenClaw session key for isolation; that requested key is
not treated as proof of a persisted transcript. Native Gateway response and history data remain the
runtime authority.

Steering is `chat.send` with `queueMode: "steer"` and a stable idempotency key. `chat.inject` is kept
only for the explicit AgentOS context-injection action. Abort uses `sessions.abort` with the exact
session key/run ID and may use `chat.abort` only when its required session key is available. AgentOS
does not expose `sessions.steer` as a modern or primary operation.

## Admission versus transcript persistence

OpenClaw 8.2 can acknowledge admission or run start before the user message is committed. AgentOS
therefore models `runStarted` / accepted / queued as admitted-but-uncommitted, and treats
`messageSeq` or a native message identity as commit evidence. The chat runner gives optimistic user
messages a submission/idempotency identity, keeps them provisional while the run is active, and
upgrades them when native history returns the committed identity.

Rehydration deduplicates by native message ID or submission identity only. Equal text is not a
deduplication key. This preserves retries, reconnects, and distinct turns while preventing one
submission from appearing twice after transcript polling or runtime events.

## Tasks and execution identity

OpenClaw task identity and status remain authoritative when available. AgentOS uses
`tasks.list`, `tasks.get`, and `tasks.cancel`; it does not invent `tasks.assign` or `tasks.create` RPCs.
Native statuses are preserved as `queued`, `running`, `completed`, `failed`, `cancelled`, or
`timed_out`, with unknown values treated as unknown/degraded rather than success.

Dispatch records are AgentOS orchestration ledgers. They contain request/actor/workspace correlation,
but do not preallocate a native session ID or replace native task/session/run identity. A dispatch
record is enriched only after native response or runtime evidence supplies the corresponding identity.

## Capability negotiation and reconnects

The persistent client validates the 8.2 hello envelope, tracks advertised methods/events/capabilities,
and refreshes them on reconnect. Gateway identity, granted scopes, and connection ID are cleared on
disconnect so a later Gateway cannot inherit stale authority. Subscription listeners are removed
without closing the shared WebSocket; message subscriptions send the native unsubscribe call when
supported.

Methods are selected from live advertisement where available, but omission from a conservative
advertisement is only unknown. AgentOS attempts the native method and records an explicit
unsupported/degraded outcome only after an authoritative Gateway error. Authorization errors remain
authorization errors and are not converted into unsupported-method fallbacks.

## Retained compatibility fallbacks

| Operation | Native preferred path | Retained fallback | Reason |
| --- | --- | --- | --- |
| Turn submission | `chat.send` | `sessions.send`, then guarded CLI | Older/partial Gateways may lack `chat.send`; semantics are recorded in diagnostics. |
| Session event streaming | `sessions.subscribe` / `sessions.messages.subscribe` | transcript/history polling and guarded CLI stream | Some older Gateways emit incomplete or status-only events. |
| Agent lifecycle | `agents.create/update/delete` | CLI only when native is absent/rejected and proof exists | AgentOS still has local policy/bootstrap/workspace side effects. |
| Channel/provider provisioning | native status/config methods where available | existing CLI/application orchestration | No single native 8.2 method covers the credential, registry, route, and session-store side effects. |
| Gateway process control | none | CLI start/stop/restart | The Gateway process cannot be controlled through a disconnected native control plane. |
| Setup/recovery/doctor | no stable native equivalent | CLI | These are installation and recovery operations, not runtime RPC projections. |

These fallbacks are compatibility-only, observable through the Gateway diagnostics and capability
matrix, and safe to remove when the minimum supported OpenClaw contract makes the native path
universal.

## Future-release checklist

Before changing the integration for a new OpenClaw release:

1. Pin the exact tag and source commit; do not compare only to `main`.
2. Recheck the official protocol package, handshake schema, method descriptors, capability names,
   error details, and client package.
3. Confirm agent/session/task identity and admission/transcript semantics with source and runtime.
4. Update the native adapter first; keep application and UI layers on normalized AgentOS contracts.
5. Add contract tests for changed payloads, capabilities, authorization, reconnect, and fallbacks.
6. Run the isolated runtime certification and record PASS, FAIL, SKIPPED, EXPECTED-DENIAL, and UNKNOWN
   with a reason for every skip.

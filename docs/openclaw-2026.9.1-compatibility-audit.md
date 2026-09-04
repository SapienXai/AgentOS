# AgentOS and OpenClaw 2026.9.1 compatibility audit

Date: 2026-09-04

Status: exact-source contract adoption and runtime-certification record.

This document records the AgentOS baseline upgrade to OpenClaw `2026.9.1`. The
active implementation remains an AgentOS control and projection layer over the
OpenClaw Gateway. It does not create a parallel runtime, transport, task
engine, worktree engine, or skills engine.

## Provenance

- Starting AgentOS HEAD: `525ab91ca8e1c080ece66c83ddf64fc86f1da7ac`
- Branch: `main`
- OpenClaw release/tag: `v2026.9.1`
- OpenClaw source: `ad6fe23aecb9b833d68139b0ddc9f239b894d2f1`
- 8.2 comparison source: `0965053fe6b9341776df147a6934b7485c60b5ca`
- Gateway protocol: `4` (minimum client `4`, minimum node `3`, minimum probe `3`)
- `@openclaw/gateway-client`: `2026.9.1`
- `@openclaw/gateway-protocol`: `2026.9.1`

The exact source was inspected in the Gateway method descriptors, event
catalog, protocol schemas, client reconnect policy, and the two published
package manifests. Historical 8.2 documents and evidence remain retained as
provenance and are not rewritten by this audit.

## Contract changes: 8.2 to 9.1

At the core method-name level, the exact source comparison is:

- Methods added: `16`
- Methods removed: `0`
- Existing method names changed: `0`
- Gateway event names added: `1` (`gateway.suspension`)
- Gateway event names removed: `0`

The additive method set is:

- Skills library: `skills.library.list`, `read`, `save`, `mutate`, `activate`,
  `import`, and `upload`.
- GitHub profile/session: `users.github.status`,
  `users.github.authorize.start`, `poll`, `cancel`, `users.github.disconnect`,
  `sessions.github.options`, `sessions.github.status`,
  `sessions.github.confirm`, and `sessions.title.prepare`.

Important schema and behavior changes observed in the exact diff:

- `GATEWAY_CLIENT_CAPS.TERMINAL_SESSION_METADATA` was added.
- `AUTH_VERIFIED_USER_REQUIRED` and `AUTHENTICATED_PROFILE_UNAVAILABLE` were
  added as structured connection-error details. The official client treats the
  verified-user requirement as non-recoverable authentication, so reconnect
  ownership does not move to AgentOS.
- Session projection/message identity handling became stricter and remains
  owned by the official client package.
- Session rows and collaboration schemas carry `createdActor`, `owner`,
  `participants`, participant count, visibility, and sharing role metadata.
- The additive skills-library contract defines bounded files, revisions,
  optimistic `expectedRevision`, ownership/share state, session selection, and
  chunked upload limits. Activation applies to the next turn while published
  changes target new sessions.
- GitHub user/session publication schemas and typed request parameters were
  added.
- Exec approval records can include MCP tool allowlist metadata, and plugin
  approval requests can identify an MCP server/tool pair.
- Cron shared validators, session title/publication schemas, terminal metadata,
  worker placement, and related public schema exports were expanded.
- No breaking change was found in the public `GatewayClient` API used by
  AgentOS. The official transport continues to own socket lifecycle, request
  correlation, timeout/abort, reconnect, device auth, and sequence-gap
  handling.

Scope changes are additive and Gateway-enforced. The new skills-library methods
use `operator.read` for list/read and `operator.write` for save/mutate/activate/
import/upload. GitHub status uses Gateway profile-aware read policy; GitHub
authorization and publication remain Gateway-controlled writes. Worktree and
session collaboration methods retain their exact per-method read/write/admin
requirements. AgentOS does not widen any scope based on client-requested
headers or requested scopes.

## AgentOS impact

The package pins, baseline constants, runtime identity contract, Railway image
pin, release consistency copy, active certification entrypoints, and current
test fixtures now target exact `2026.9.1`. The normalized capability registry
also records `productIntegration: "discovery-only"` for OpenClaw-owned surfaces
that AgentOS does not yet expose as product workflows.

The official transport architecture did not require redesign. Existing layers
remain:

`AgentOS policy/domain client -> request policy -> coordinator/reconciliation -> official GatewayClient -> OpenClaw Gateway`

CLI remains an explicit, observable recovery path only where the existing
operation allows it. No custom transport, custom reconnect loop, or direct
OpenClaw calls from React components were added.

## New capability discovery

The following exact Gateway surfaces are represented in the existing capability
matrix and contract registry. They are discovery-only unless stated otherwise;
there is no new product UI or mutation path for them.

| Surface | State | Exact methods/events | Ownership |
| --- | --- | --- | --- |
| Managed worktrees | FUTURE PRODUCT ADOPTION | `worktrees.list`, `branches`, `create`, `remove`, `restore`, `gc`; no dedicated event | OpenClaw worktree service |
| Task suggestions | FUTURE PRODUCT ADOPTION | `taskSuggestions.list/create/accept/dismiss`; `task.suggestion` | OpenClaw ephemeral suggestion registry |
| Skills library | FUTURE PRODUCT ADOPTION | `skills.library.list/read/save/mutate/activate/import/upload`; no dedicated event | OpenClaw library, revisions, and activation |
| Session collaboration/ownership | FUTURE PRODUCT ADOPTION | visibility, members, suggestions, typing, discussion, `sessions.assignOwner`; `session.sharing`, `session.sharing.evidence`, `session.typing` | OpenClaw profile/session authority |
| GitHub profile/session publication | FUTURE PRODUCT ADOPTION | `users.github.*`, `sessions.github.*`, `sessions.title.prepare` | OpenClaw profile and publication authority |
| Approval MCP metadata | DISCOVERED | additive response/request fields | OpenClaw approval authority |
| Terminal session metadata | DISCOVERED | `terminal-session-metadata` capability | OpenClaw terminal/session authority |

Worktree parameters are exact-source bounded (`repoRoot`, optional name/baseRef,
worktree id, and optional force); branch inspection can include repository
status. Task suggestions are ephemeral, have bounded title/prompt/tldr/cwd
fields, and accept into `worktree`, `local`, `cloud`, or `session` modes. Skills
library writes use revision fencing and bounded file/bundle sizes. Session
collaboration is profile-aware and preserves principal-less evidence as a
distinct event rather than inventing an actor.

## Session/task contract

- `tasks.list`: native Gateway snapshot/read RPC.
- `tasks.get`: native Gateway snapshot/read RPC.
- `tasks.cancel`: native Gateway mutation.
- Raw task event: `task`.
- `tasks.subscribe`: absent from the exact contract and absent from AgentOS.
- `sessions.subscribe`: native session subscription owned by the official
  transport/coordinator path.
- `sessions.messages.subscribe`: native transcript subscription owned by the
  official transport/coordinator path.
- Session ownership metadata: Gateway session rows expose the exact ownership,
  participant, visibility, and sharing fields; AgentOS projects them without
  becoming the owner of that state.

## Auth, lifecycle, and request policy

The upgrade leaves the security and lifecycle ownership model unchanged:

- Managed writes use the existing AgentOS managed-write and stale-writer
  fencing rules.
- Device identity, v3 signing, stored token handling, clear/recovery, and
  explicit token/password semantics remain in the established boundaries.
- Granted Gateway scopes are audited from `hello-ok`; requested scopes are not
  treated as proof of authorization.
- Read coalescing, the 300 ms read cache, mutation/reconnect invalidation,
  generation fencing, and per-request abort isolation remain AgentOS request
  policy semantics.
- `GatewayClient` remains the only production reconnect owner. HelloOk,
  subscription replay, sequence-gap handling, post-reconnect RPC, and event
  delivery continue through the official transport and coordinator.

## Runtime certification

Certification is performed against an exact, built `v2026.9.1` source runtime
with disposable state, loopback-only provider fixture, isolated Gateway port,
and no user Gateway, provider credentials, cookies, or browser state. The
sanitized result is recorded in
[`docs/evidence/openclaw-2026.9.1-runtime-certification.json`](evidence/openclaw-2026.9.1-runtime-certification.json).

The evidence records the exact clean AgentOS code commit that was executed,
the exact OpenClaw source commit and build identity, handshake, method/event/
scope matrices, reconnect and request-policy checks, package resolution, safe
denials, and explicit external-integration skips. It contains no secrets or
private local paths.

## Known skips and exceptions

Real external model/chat credentials, Telegram, WhatsApp, and server-side token
rotation are not required for the isolated baseline. They are skipped with
explicit reasons in the evidence artifact. This is not a claim that external
provider or channel production cutover was tested.

## Future product adoption

No future product surface is implemented by this upgrade.

P1:

- Managed Worktrees / Native Work Model
- Task Suggestions
- Native session ownership / handoffs
- Skills Library / Effective Capabilities
- Human Control Inbox

P2:

- Personal model accounts / scoped model selection
- Memory repair/reset UX
- Upstream update/Doctor delegation

P3:

- Deeper nodes/environments/placement

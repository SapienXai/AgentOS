# AgentOS and OpenClaw 2026.9.1 Multi-user Identity and Collaboration

This document records the Phase 7 boundary for the pinned OpenClaw 2026.9.1
runtime (`ad6fe23aecb9b833d68139b0ddc9f239b894d2f1`). AgentOS is a protected
trusted-team control plane, not a hostile multi-tenant security boundary.

## Identity ownership

AgentOS owns the authenticated browser actor, its immutable `actorId`, the
local password session, the `owner`/`member` product role, and product
permissions. OpenClaw owns native `UserProfile` identity, Gateway role and
scope, device and connection identity, and native session attribution.

The current deployment uses one shared backend Gateway credential:

```text
AgentOS actor -> AgentOS product authorization -> shared OpenClaw connection
```

The native connection is therefore attributed to the shared service. A
successful shared-service request does not prove that the current AgentOS
actor is the OpenClaw `users.self` profile. AgentOS reports this explicitly as
`connectionAttribution: shared-service` and
`nativeHumanIdentityVerified: false`.

An optional `actorId` to native `profileId` association is compatibility
metadata only. It is not authentication, does not grant permissions, and is
not used to select the current native caller. AgentOS never creates native
profile IDs and never matches profiles automatically by email, username,
display name, avatar, or role. A profile missing from the current native
`users.list` result is projected as `STALE`; it is not remapped.

## Exact native user contract

The pinned runtime exposes:

| Method | Params | Response | Scope | AgentOS use |
| --- | --- | --- | --- | --- |
| `users.list` | `{}` | `{ profiles: UserProfile[] }` | `operator.read` | lazy native directory and target validation |
| `users.self` | `{}` | `{ profile: UserProfile }` | `operator.write` plus authenticated-profile checks | discovery-only; never mapped to the browser actor in shared-service mode |
| `users.setDisplayName` | `{ profileId, displayName }` | `{ profile: UserProfile }` | `operator.write` plus target ownership/admin checks | native client contract only |
| `users.setAvatar` | `{ profileId, mime, avatarBase64 }` | `{ profile, avatarRevision }` | `operator.write` plus target ownership/admin checks | native client contract only |
| `users.linkEmail` | `{ email, targetProfileId }` | `{ profile: UserProfile }` | `operator.admin` | native contract only |
| `users.setRole` | `{ profileId, role }` | `{ profile: UserProfile }` | `operator.admin` | explicit OpenClaw role administration |

There is no pinned `users.create` Gateway method. Native profiles are
resolved by OpenClaw when an exact authenticated identity path is available;
AgentOS local passwords are never delegated to OpenClaw.

The normalized profile preserves the native `profileId`, `emails`, avatar
presence/type, merge identity, timestamps, GitHub identity, and native role.
The native role is refreshed from OpenClaw and is never treated as an
AgentOS product role.

## Role separation

AgentOS `owner` and `member` remain independent from OpenClaw's
Gateway-defined role names. Changing an AgentOS role never calls
`users.setRole`; changing a native role never changes the AgentOS account.
The OpenClaw role picker validates live native role definitions and remains
owner/product-gated.

## Session collaboration ownership

OpenClaw is authoritative for session `createdActor`, owner, participants,
visibility, sharing role, and membership evidence. AgentOS composes the
existing selected-session ownership detail and, from the selected-session
surface only, native calls:

- `session.members.list` / `session.members.listEvidence` (`operator.read`)
- `session.visibility.set` (`operator.write`)
- `session.members.add` / `session.members.remove` (`operator.write`)
- `sessions.assignOwner` (`operator.write`)

The selected-session UI keeps these controls bounded and uses a lazy native
profile directory for human targets. It does not create an AgentOS ACL.
Suggestions, typing, and discussion remain future/discovery surfaces.

Agent owner assignment continues to use the native `{ type: "agent", id }`
identity. The selected native human-owner path, where used, first validates a
fresh `users.list` profile and sends that exact native `profileId`. An
AgentOS `actorId` is never accepted as a native human identity.

Collaboration mutations require the dedicated AgentOS
`sessions.collaborate` permission. The first-safe policy grants it to owners
only; members retain `sessions.use` for permitted reads. Product policy is
checked before the shared Gateway transport, followed by exact native scope
preflight and Gateway target authorization.

## Mutation and attribution safety

Native mutation timeouts are not retried blindly. AgentOS performs the
smallest authoritative reread where the operation supports it: membership
mutations use `session.members.list`, visibility uses `sessions.describe`, and
owner assignment uses `session.members.list`. If the postcondition is not
proven, the result remains unknown/failure rather than being claimed as
successful.

AgentOS audit records the local actor, operation, safe native target, result,
and timestamp. It does not rewrite OpenClaw's `createdActor` or owner and does
not claim that OpenClaw saw the AgentOS human when the shared service was the
native caller.

## Performance and security boundary

The root Dashboard performs no new identity or collaboration reads. Native
user directory reads are lazy, and selected-session collaboration reads stay
bounded to the existing members and evidence calls. There is no per-session
membership fan-out, no per-user `users.self` fan-out, no local session ACL
database, no per-human OpenClaw credential store, no new event transport, no
polling, and no CLI fallback for these native operations.

Native profile, question, session, and membership content is untrusted data.
It is redacted and rendered as data; it is never treated as AgentOS system
instructions. AgentOS product permissions and OpenClaw scopes remain separate
enforcement layers, with Gateway authorization final.

## Runtime limitations

The shared-service mode cannot provide per-human native OpenClaw attribution
without a future delegated native connection architecture. A disposable
runtime may legitimately have no profiles, and live human profile creation,
human membership mutation, and human ownership mutation remain skipped unless
an exact verified native profile fixture exists. This is an explicit limitation,
not a fabricated identity result. Mutually untrusted organizations require
separate AgentOS/OpenClaw security domains; Phase 7 does not add tenants,
organizations, SSO, invitations, or hostile-tenant isolation.

## Phase 7.1 — Mutation Truthfulness

Native collaboration and OpenClaw role mutations use the shared
`classifyNativeMutationError` contract. A structured definite rejection (for
example a scope, authorization, conflict, malformed-request, unsupported, or
rate-limit response) is reported as `failed`, is audited as failed, and is not
reconciled into success. A request that may have been delivered is treated as
`unknown` until one bounded authoritative reread proves a state transition.
Mutations are never retried blindly.

Ambiguous reconciliation is causal: the relevant pre-state is captured when
it can be read within the existing bounded operation. A member add/remove,
visibility change, owner assignment, or native role change is only reported as
reconciled success when the post-state matches the request and differs from
the captured pre-state. If the desired state already existed, or the pre-state
cannot be established, a matching post-state remains `unknown`.

The API exposes `outcome: "failed"` for proven native rejection and
`outcome: "unknown"`, HTTP 409, and `retryable: false` for unresolved delivery.
The latter uses neutral wording: OpenClaw may have applied the change, but
AgentOS could not verify the final native state. Audit results remain aligned
with these outcomes: native success and proven reconciliation are succeeded,
definite rejection is failed, and inconclusive delivery is unknown.

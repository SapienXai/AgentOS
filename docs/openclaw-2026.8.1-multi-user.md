# AgentOS / OpenClaw 2026.8.1 Trusted-Team Multi-User Foundation

## Product scope

Phase 4B defines one protected AgentOS instance as one trusted team/workspace. It supports multiple AgentOS human accounts with `owner` and `member` product roles. It does not provide hostile-tenant isolation, organizations, billing, SSO, invitations, or enterprise directory synchronization.

Mutually untrusted tenants must use separate AgentOS security domains and separate OpenClaw Gateway state, credentials, and runtime boundaries until a separate isolation design is certified.

## Exact OpenClaw 8.1 user provisioning

The pinned OpenClaw 8.1 Gateway exposes `users.list`, `users.self`, `users.setDisplayName`, `users.setAvatar`, `users.linkEmail`, and `users.setRole`. It does not expose `users.create`.

A durable OpenClaw `UserProfile` is resolved or created by the runtime when a verified identity is available, such as trusted-proxy or Tailscale identity/email resolution. `users.self` uses the authenticated Gateway profile identity. A shared token/password connection does not establish a human profile identity. AgentOS local passwords therefore cannot be converted into OpenClaw profile credentials by this phase.

`users.setRole` accepts `{ profileId, role }`, where `role` is `null` or a role defined by the active `gateway.roles.definitions` policy. A role update invalidates the profile connection and the new ceiling applies after reconnect. There is no exact 8.1 `users.disable` surface in the inspected Gateway contract; AgentOS disables its own user and revokes its AgentOS sessions.

## AgentOS account model

The canonical multi-user store is the owner-only file `agentos-users.json`, version 1, under the AgentOS runtime directory. Each record contains:

- immutable UUID `actorId`;
- normalized unique login `username`;
- `owner` or `member` product role;
- `active` or `disabled` status;
- scrypt password salt/hash;
- per-user `sessionVersion` and timestamps;
- presentation profile fields;
- optional OpenClaw mapping metadata.

The actor ID is the security identity. Username, email, display name, and avatar are mutable presentation or login metadata and are never the sole security principal. Browser sessions are signed server-issued cookies containing a server-verified actor ID and session version; browser input cannot provide actor, role, scopes, profile ID, or Gateway connection ID.

The existing Phase 4A Instance Protection v2 owner is migrated on read or first login. The existing actor ID, username, password hash, and owner authority are preserved. The original `operator-profile.json` is retained as an owner compatibility sidecar, while the account store is canonical for the current human profile.

## Product roles and policy

AgentOS intentionally has only two human product roles in this phase:

| Role | Product capability | Explicit denial |
| --- | --- | --- |
| `owner` | runtime use, user management, lifecycle, updates, migrations, Gateway settings, security, secrets, agent management, OpenClaw role mapping | none within the bounded first-stable product policy |
| `member` | runtime use, sessions, tasks, missions, agent read, own profile | users, lifecycle, updates, migrations, Gateway settings, security, secrets, agent create/update/delete, OpenClaw role mapping |

The product policy is centralized in `agentos-product-authorization.ts`. A shared service actor has an explicit automation permission set and is not treated as a human owner for owner-only user/security operations. Internal recovery uses an explicit internal-service actor.

For Gateway-backed mutations, the order is:

```text
signed AgentOS session
        ↓
server-derived AgentOS actor
        ↓
central AgentOS product permission
        ↓
actual OpenClaw granted role/scopes
        ↓
OpenClaw target/runtime authorization
        ↓
Gateway enforcement
```

AgentOS policy runs before a shared privileged Gateway transport is used. OpenClaw remains the final runtime authority. Dynamic operations such as session mutation, agent/node actions, and secret-sensitive Talk operations remain runtime-dependent where the 8.1 contract requires target or runtime checks.

## OpenClaw profile mapping and connection strategy

AgentOS stores an optional `actorId ↔ profileId` mapping with a separate OpenClaw role and linkage state. The mapping is not an authentication principal and does not grant a local AgentOS user an OpenClaw credential. The owner-only `/api/users/openclaw` surface validates profile IDs against the live `users.list` result before metadata linkage or role assignment. `users.setRole` is native-only, owner-gated, requires a proven OpenClaw admin capability, and validates the requested role against the active Gateway role definitions when exposed.

The certified connection strategy is **shared trusted service**:

- AgentOS currently has one backend native Gateway credential.
- The credential is not reused as proof that every human is an OpenClaw admin.
- Human product policy is checked before the transport call.
- A member's owner-only request is denied before the shared Gateway client is invoked.
- A member's permitted runtime operation may use the shared service transport, but audit attribution remains the AgentOS member and OpenClaw attribution is honestly reported as shared service.

Per-human native Gateway delegation is deferred because exact 8.1 shared-token/password authentication does not establish a durable human profile, and this repository has no safe server-side store for per-human OpenClaw device/profile credentials. No profile IDs or tokens are manufactured.

## Sessions and agents

OpenClaw 8.1 exposes session metadata including `createdActor`, `owner`, `participants`, `sharingRole`, and visibility. `sessions.list` supports creator/owner/involving-me filters, and `sessions.assignOwner` is an identified-caller operation. `sessions.create`, `sessions.patch`, and `sessions.delete` remain scope and target/runtime dependent. AgentOS does not create a second authoritative session ACL.

With the shared service connection, AgentOS can attribute the initiating human in its own audit envelope but cannot claim that OpenClaw recorded that human as the Gateway creator. Agents are treated as trusted-team resources subject to OpenClaw role policy; AgentOS does not invent per-user agent ownership or ACLs.

## User management and safety

Owners can list and create users, change product role, enable/disable users, and set a password through `/api/users`. There are no invitations or recovery email flows. Disabled users cannot authenticate and their current session version is rejected. At least one active owner is required; the final owner cannot be demoted or disabled.

The API derives the acting actor from the signed session. Target IDs are validated as server-side user records. Profile changes update the current user's presentation profile without changing actor ID or authorization. Login retains scrypt hashing, constant-time comparison, a dummy-hash path for unknown users, generic invalid-credential errors, and username-keyed rate limiting.

## Audit attribution

AgentOS records only non-sensitive mutation metadata: actor ID, authentication method, operation, safe target kind/ID, result, and timestamp. Passwords, hashes, cookies, Gateway tokens, provider secrets, prompts, and conversation content are excluded. Owner, member, API-token service, and internal-service actors remain distinguishable.

OpenClaw records its native Gateway/profile/session metadata when the authenticated connection supports it. The shared service connection limitation is explicit: OpenClaw sees the shared Gateway operator rather than the AgentOS human for those transport calls.

## Security boundary and limitations

The following are enforced server-side:

- browser actor/role/profile/scope spoofing is rejected;
- members cannot inherit shared-service admin authority;
- owner-only control-plane operations are product-gated;
- OpenClaw requested scopes are never treated as granted scopes;
- disabled users lose AgentOS authority;
- profile edits do not mutate actor identity;
- internal-service actors are not selectable through public requests;
- evidence excludes secrets and private disposable paths.

This is a trusted-team foundation, not hostile tenant isolation. Native per-human OpenClaw attribution, profile credential provisioning, and tenant isolation are explicit follow-up work. Hard deletion, invitations, password reset email, SSO, organization management, and enterprise policy are outside Phase 4B.

## Evidence

The isolated runtime certification artifact is `docs/evidence/openclaw-2026.8.1-multi-user.json`. It records the exact OpenClaw package identity, AgentOS code commit under test, account/session checks, shared-service escalation check, runtime session result, audit differentiation, cleanup, and gate without recording secrets.

## Phase 4B.1 consistency hardening

The canonical protected-session path is now:

```text
signed cookie
  -> instance signing epoch
  -> canonical actor ID
  -> agentos-users.json lookup
  -> active status and per-user sessionVersion
  -> AgentOsActorContext
  -> central product permission
```

`getInstanceProtectionStatus` and actor resolution use the same active-session validator. A valid signature alone is insufficient: unknown, disabled, stale, malformed, or missing-store actors fail closed. The only missing-store compatibility path is a controlled migration for the legacy Instance Protection owner whose signed actor and session version still match the v2 state. Corrupt account data never falls back to the legacy owner.

Account-store writes are read/modify/write transactions serialized by runtime-directory key. Atomic rename remains the individual-write durability boundary; the process-local queue prevents lost updates between concurrent account mutations in the supported single-process deployment. Multi-replica concurrent writers are not certified by this phase and require a shared lock or database before horizontal writes are enabled.

Every durable store mutation is validated for unique actor IDs and normalized usernames, valid owner/member roles, valid active/disabled status, positive session versions, valid profile/linkage shapes, and at least one active owner. Role, password, and status changes increment only the target user's session version. Profile changes do not revoke sessions. The final active owner cannot be demoted or disabled, including when competing mutations run concurrently.

Protection lifecycle is intentionally deterministic. Disabling protection is rejected with `multi-user-protection-required` when more than one AgentOS account exists. With exactly one active owner, the API removes the Instance Protection state and canonical account security store together; re-enabling creates one fresh owner actor from the new credentials. The explicit CLI auth reset follows the same security-state cleanup while preserving workspaces, agents, tasks, integrations, and OpenClaw data. An account store found without matching Instance Protection state is treated as orphaned security state and cannot silently become a new protected instance.

The historical `operator-profile.json` remains an owner compatibility sidecar. Protected member profile edits update only that member's canonical account profile; they do not overwrite the owner sidecar. The profile endpoint is product-permission-gated, and workspace `USER.md` is shared workspace context rather than a personal profile. Its write route requires `workspace.manage`, which members do not receive.

OpenClaw linkage remains metadata only because the shared trusted service credential does not establish a per-human OpenClaw identity. A profile ID may be linked to at most one AgentOS actor. Native role mutation updates linkage metadata only after OpenClaw succeeds, and duplicate linkage is rejected. OpenClaw remains the final runtime authority; AgentOS product policy must run before any shared privileged transport call.

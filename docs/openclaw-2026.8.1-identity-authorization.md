# OpenClaw 2026.8.1 Identity and Authorization Foundation

Status: Phase 4A evidence and architecture record.

This document describes the identity boundary currently implemented by AgentOS and the exact OpenClaw 2026.8.1 contract used for runtime verification. It does not introduce the Phase 4B multi-user product.

## AgentOS Authentication

AgentOS Instance Protection authenticates the human operator with a signed, HttpOnly, SameSite session cookie. The persisted protection record is owner-only and now uses state version 2. Existing version 1 records migrate on read by adding a random stable actor identifier while preserving the username, password hash, session secret, session version, and current session semantics.

The API token path is a separate service authentication method. A valid API token resolves to the fixed service actor `service:agentos-api-token`; it is never presented as the browser operator. In development without Instance Protection, a safe loopback request resolves to an explicit `unprotected-local` context with `authenticated: false`. Internal server operations use `service:agentos-internal` and cannot be selected by request headers.

Origin, host, loopback, and trusted-remote checks remain request-safety controls. They are not treated as authentication.

## AgentOS Actor Identity

The server-side `AgentOsActorContext` contains:

```ts
type AgentOsActorContext = {
  actorId: string;
  kind: "instance-operator" | "service" | "internal-service";
  username: string | null;
  displayName: string | null;
  authenticationMethod:
    | "instance-session"
    | "api-token"
    | "internal-service"
    | "unprotected-local";
  authenticated: boolean;
  agentOsRole: "owner" | null;
};
```

The current protected AgentOS product has one human role, `owner`. This is an instance-level product role, not an OpenClaw role and not a multi-user claim.

`actorId` is a generated UUID persisted in Instance Protection state. Username, password, profile name, and email changes do not change it. The browser cannot submit or override it.

## Operator Profile Separation

`operator-profile.json` remains presentation metadata: full name, username, email, avatar, and update time. It is stored as version 2 with an optional actor linkage. Profile linkage is useful for display and migration, but profile values are not security principals.

The profile sidecar migrates safely from version 1 and links to the existing Instance Protection actor when one exists. A profile username or email update therefore does not invalidate or replace the actor. Profile changes also do not grant an AgentOS role.

## OpenClaw Connection Identity

The current native AgentOS connection sends the existing backend identity:

```text
client.id   = gateway-client
client.mode = backend
role        = operator
```

The native connection now stores two separate values:

```text
requested role/scopes -> OpenClaw handshake -> granted role/scopes
```

The handshake is authoritative. The AgentOS identity record captures `hello-ok.server.connId`, `hello-ok.auth.role`, `hello-ok.auth.scopes`, device identity when present, authentication state, and the `native-handshake` source. A CLI fallback is explicitly represented as `cli-fallback` with no claimed granted scopes.

In the isolated 2026.8.1 E2E, shared token connections returned role `operator`, unique connection IDs, no device ID, and the exact requested scope set as granted for each controlled profile. This is runtime evidence for this token-auth configuration; it is not a general assumption that requested and granted scopes are always equal.

## Exact OpenClaw 8.1 Identity Model

The pinned runtime artifact is OpenClaw `2026.8.1`, source commit `ea806575e6450e4d1efdfc72c19f04be982a1b9b`, build `2026.8.1-ea806575e645-2026-08-31T00-16-08.235Z`. The source/runtime inventory is exported from `lib/openclaw/identity/contract.ts` and embedded in the sanitized E2E artifact.

The exact 8.1 Gateway contract exposes durable profile methods:

| Method / field | Contract finding |
| --- | --- |
| `connect.client.id`, `mode`, `instanceId` | Connection identity and presence key inputs. |
| `connect.role`, `connect.scopes` | Requested Gateway role and scopes. They are not proof of the granted result. |
| `connect.auth.token/password` | Shared Gateway authentication. A shared token does not identify a human AgentOS caller. |
| `connect.auth.deviceToken` and `connect.device` | Device-backed identity and pairing proof. |
| `hello-ok.server.connId` | Connection-local Gateway identity. |
| `hello-ok.auth.role/scopes` | Actual role/scope evidence exposed by the tested native handshake. |
| `users.list` / `users.self` | Durable Gateway user-profile discovery (`operator.read` / `operator.write`). |
| `users.setDisplayName` / `users.setAvatar` | Gateway profile presentation mutations (`operator.write`). |
| `users.linkEmail` | Gateway profile email linkage (`operator.admin`). |
| `users.setRole` | Gateway role assignment (`operator.admin`). |
| `sessions.create/patch/delete/dispatch` | Scope and target/runtime-dependent session authority. |
| `agents.list/create/update/delete` | Read or admin Gateway agent authority, with profile role policy where configured. |
| `question.*` | Dedicated `operator.questions` surface. |
| `exec.approval.*` | Dedicated `operator.approvals` surface. |
| `device.pair.*` | Dedicated `operator.pairing` surface. |
| `talk.*` | Ordinary Talk uses `operator.talk`; secret-inclusive `talk.config` additionally uses `operator.talk.secrets` and read. |
| `node.invoke` | Dynamic command, target, node, and runtime authority. |
| `config.patch/set/apply` | Admin scope plus schema, path, hash, and reload/runtime enforcement. |

OpenClaw 8.1 has native persistent user/profile and role primitives. AgentOS does not yet map its future multiple human accounts to those profiles; that is intentionally deferred to Phase 4B.

## Roles and Scopes

The exact operator scope set used by this phase is:

```text
operator.admin
operator.read
operator.write
operator.approvals
operator.questions
operator.pairing
operator.talk
operator.talk.secrets
```

The current shared AgentOS backend connection requests the complete set because the current single-operator application uses Gateway configuration, agent, approval, device, question, and Talk surfaces through one persistent client. Dedicated scope requirements are nevertheless retained in the contract and capability service; the application does not treat the broad backend request as per-human delegation.

`operator.talk.secrets` is never treated as implied by ordinary Talk. `operator.questions`, `operator.approvals`, and `operator.pairing` are separate capabilities.

## Requested Versus Granted Scopes

`OpenClawOperatorIdentity` stores `requestedRole`, `role`, `requestedScopes`, `grantedScopes`, `grantedScopesKnown`, `deviceId`, `connectionId`, `authenticated`, and `source`. The authorization service only uses `grantedScopes` when `grantedScopesKnown` is true and the source is a successful native handshake. Requested scopes alone produce `unknown`, never permission.

## Dynamic Authorization

AgentOS preflight is deliberately bounded. It answers static capability questions from actual Gateway identity evidence, then reports runtime-dependent work as `runtime-required`:

- normal `sessions.create` / safe `sessions.patch` / archived-only `sessions.delete` use write authority;
- incognito, full-permission, unsafe session field, and unrestricted delete paths require admin;
- `sessions.dispatch`, `sessions.move`, `agent`, `node.invoke`, and secret-sensitive Talk paths depend on parameters and target/runtime state;
- `config.patch`, `config.set`, and `config.apply` retain admin scope plus Gateway schema, path, hash, and reload checks;
- question resolution and approval/device actions retain their dedicated static scope and Gateway lifecycle enforcement.

The preflight never replaces the Gateway call. A known missing static scope is blocked early; `runtime-required` and unavailable/unknown identity states remain honest and reach the final OpenClaw enforcement point when the application elects to proceed.

## Session Identity Findings

From the exact 8.1 runtime contract and compiled source evidence:

| Question | Finding |
| --- | --- |
| Creator | `createdActor` is persisted for sessions created with an authenticated OpenClaw user profile. |
| Owner | Session sharing derives owner/member/viewer/admin from creator/profile identity, session visibility, and sharing configuration. |
| Cross-operator visibility | Not scope-only when profile-aware session sharing is active; visibility and sharing policy apply. Shared-token backend connections use a trusted shared Gateway model and do not establish a distinct human profile. |
| Mutation authority | Scope, session target, visibility, creator/member role, and runtime checks all participate. |
| Persistent identity metadata | `createdActor`, `owner`-derived sharing role, `participants`, `sharingRole`, and `visibility` are exposed where the session surface includes them. |
| AgentOS mapping | Not exposed in the current AgentOS connection; no fake mapping is added. |

The identity E2E intentionally uses token-authenticated disposable connections, so it proves scope and runtime behavior but does not claim a human-profile `createdActor` value for those connections.

## Agent Identity Findings

| Question | Finding |
| --- | --- |
| Creator | No AgentOS actor is sent to OpenClaw as an agent creator in this phase. |
| Owner | No per-AgentOS-user agent owner was exposed by the tested Gateway surface. |
| Cross-operator visibility | Agents are global within the current trusted Gateway unless OpenClaw profile role policy filters the surface. |
| Mutation authority | `agents.create`, `agents.update`, and `agents.delete` require admin scope and final Gateway enforcement. |
| Persistent identity metadata | Agent ID/configuration and Gateway role-policy state; no invented AgentOS ACL. |

## Trust Boundary Decision

Decision: **Hybrid — native per-user authorization exists in OpenClaw 8.1, while the current AgentOS integration is a shared trusted Gateway connection.**

OpenClaw 8.1 supports Model B primitives (`users.*`, profile-linked roles, profile-aware session sharing). The current AgentOS backend still uses one shared `gateway-client` / `backend` connection and a service-owned Gateway credential, which is Model A behavior. It is suitable for one protected operator and trusted teams, but it is not a claim of mutually untrusted user isolation.

Phase 4B must choose explicit profile/token delegation or isolated Gateway/state roots for hostile tenant boundaries. AgentOS does not fabricate per-user OpenClaw tokens or pretend the current shared token identifies each future human.

## Security Boundary

```text
Human
  -> AgentOS Instance Protection / API token / internal boundary
  -> AgentOsActorContext (stable actorId, auth method, owner or explicit service role)
  -> AgentOS application preflight (known static capability or runtime-required)
  -> native OpenClaw Gateway connection identity (actual role/granted scopes/connId)
  -> OpenClaw method, target, profile, schema, and runtime enforcement
  -> agents / sessions / config / approvals / questions / Talk / nodes
```

The frontend supplies only ordinary domain input. It cannot supply actor ID, AgentOS role, OpenClaw role, granted scopes, device ID, or connection ID. Gateway credentials and device material are not included in diagnostics or the evidence artifact.

## Audit Attribution

AgentOS appends a protected `agentos-audit.jsonl` envelope for selected sensitive operations. Each record contains only:

```text
actorId
authenticationMethod
operation
targetKind
targetId when safe
result
timestamp
```

Covered boundaries include Gateway lifecycle control, Gateway config/auth/device mutations, agent create/update/delete, runtime device approval, migration/update initiation, profile update, and selected runtime issue actions. Passwords, API/Gateway/provider tokens, cookies, private keys, prompts, and session content are excluded.

OpenClaw itself records connection identity, connection/session state, role/scope decisions, and profile/session metadata where its 8.1 runtime supports them. With shared token authentication, Gateway attribution is to the authenticated shared operator connection rather than a human AgentOS profile.

## Compatibility and Limitations

- Native AgentOS handshake identity is now available through diagnostics and the application authorization service.
- CLI fallback reports `cli-fallback` and no granted scope evidence; it cannot be used as proof of native Gateway authorization.
- The broad default backend scope request remains intentional for the current single-operator product and is not a per-user authorization scheme.
- The local OpenClaw working checkout was not changed. Runtime evidence used the exact 2026.8.1 package whose `dist/build-info.json` carries the pinned source commit and build ID.
- Phase 4A does not add additional AgentOS users, invitations, teams, billing, tenancy, role management UI, or hostile tenant isolation.

## Phase 4B Implications

Phase 4B can build on the stable AgentOS actor ID, profile linkage, native granted-scope diagnostics, dedicated capability checks, and audit envelope. It must also define how an AgentOS human maps to an OpenClaw Gateway profile/session/device, or select isolated Gateways where shared trust is insufficient.

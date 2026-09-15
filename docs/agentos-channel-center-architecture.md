# AgentOS Channel Center Architecture

Status: implementation contract for the Channels refactor (2026-09-15)

## Source-of-truth boundary

OpenClaw is the source of truth for channel plugins, provider availability and
capabilities, account identity and authentication, lifecycle, runtime status,
native routing bindings, provider route semantics, and native access policy.
AgentOS is the source of truth only for workspace association, tenant and
product authorization, presentation labels, audit metadata, and recovery UX.

`channel-registry.json` remains a compatibility projection for workspace
ownership and legacy UI state. It is not an authority for account credentials,
runtime status, provider availability, route discovery, or executable routing.

## Canonical model

The user-facing model is provider -> account -> route -> access policy -> agent
binding. A route identity always contains its provider and account scope:

```text
ChannelProvider
  ChannelAccount(provider, accountId)
    ChannelRoute(provider, accountId, kind, routeId, parentRouteId?)
      RouteAccessPolicy
      AgentBinding
```

The route kinds are provider-neutral (`dm`, `group`, `channel`, `thread`,
`topic`, `role`, and `peer`) and are extended only when a provider genuinely
needs a distinct native concept. Access policy and agent binding are separate:
an allowed route may have no AgentOS workspace binding, and a binding must not
implicitly grant access.

### Route translation

`ChannelRouteIdentity` is deliberately more expressive than an OpenClaw
binding. The serializer is the only place that translates the AgentOS route
model into `match` data:

| AgentOS route | Native OpenClaw representation |
| --- | --- |
| direct message | `peer.kind: "direct"` |
| Telegram/WhatsApp group | `peer.kind: "group"` |
| Discord channel | `peer.kind: "channel"`, optionally constrained by `guildId` |
| Discord guild | `guildId` scope |
| Slack channel | `peer.kind: "channel"`, optionally constrained by `teamId` |
| Discord role selector | `guildId` plus `roles` |
| Telegram topic | native Telegram topic config, not a binding peer |
| Discord/Slack thread | parent peer inheritance; no `peer.kind: "thread"` |

OpenClaw currently accepts `direct`, `group`, and `channel` peers. It treats
`group` and `channel` as compatible during matching. AgentOS therefore never
serializes its conceptual `thread`, `topic`, or generic `peer` kinds as an
invented native peer kind. A route that has no native binding primitive is
shown as inherited or provider-native instead.

### Native binding precedence

The resolver follows OpenClaw 2026.9.4's ordered tiers. A binding is eligible
for the route only when its channel and account scope match: an omitted
`accountId` means the default account, while `accountId: "*"` is explicitly
cross-account. Within a tier, the first matching entry in the `bindings`
array wins, and every supplied field is conjunctive.

1. exact peer
2. parent peer (thread inheritance)
3. peer wildcard
4. guild plus roles
5. guild
6. team
7. account
8. channel-wide `accountId: "*"`
9. configured/default owner

AgentOS reports the selected entry as the effective route. Later entries in
the same winning tier are `shadowed` and are surfaced as editing ambiguity;
they are not reported as a runtime conflict because OpenClaw resolves them
deterministically. An explicit route override replaces only the exact native
binding it can identify. Creating an override adds a more-specific binding;
clearing it removes only that owned exact entry and reveals the inherited
result. If an exact target cannot be identified, the mutation is refused.

Threads follow the parent peer in this release. Telegram topics first use an
explicit native topic `agentId`, then the parent group's binding. This keeps
the UI honest about inheritance and avoids creating unsupported runtime
objects.

The old `WorkspaceChannelGroupAssignment` is a compatibility projection of a
route binding. Existing records are read and normalized; new directory reads
use the canonical route contract and never infer an account from a route ID.

## OpenClaw 2026.9.4 findings

AgentOS was aligned against the stable `2026.9.4` release and source commit
`3a9d69db306cd7f081e06254cb89c4bcc14a7107`.

- `channels.status`, `channels.start`, `channels.stop`, and `channels.logout`
  are native Gateway operations and remain behind the existing AgentOS
  authorization preflight.
- Plugin inventory is exposed through OpenClaw plugin APIs. Plugin install and
  uninstall require the documented restart behavior; AgentOS must expose that
  as lifecycle state rather than silently treating install as connected.
- Directory peers, groups, and group members are official structured CLI
  commands in this release. There is no documented native `directory.*`
  Gateway RPC in the 2026.9.4 system/channel RPC contract. The directory
  adapter therefore owns transport selection and reports `openclaw-cli` as an
  explicit degraded transport when it uses those commands.
- Telegram group policy, allowlists, mention gating, account-level group
  inheritance/replacement, and forum topics are OpenClaw configuration and
  routing semantics. AgentOS presents them and does not create a parallel
  Telegram router. Topics are child routes under a group; they are not fake
  groups.

## Directory transport contract

The application layer calls `listChannelPeers`, `listChannelGroups`, and
`listChannelGroupMembers`. It does not know whether a future OpenClaw version
serves them through Gateway RPC, an official structured CLI, or a documented
compatibility read. The adapter returns bounded normalized entries plus source,
account scope, and degraded diagnostics.

The current official CLI fallback is account-aware and uses JSON output. Log
scraping is not a directory transport and is not part of the normal Telegram
path. Config-backed Telegram topics are explicitly source-labelled because
OpenClaw exposes them as configuration entries rather than a directory list in
this contract.

## UI responsibilities

Channels is the canonical management surface for provider, account, routes,
access, lifecycle, and diagnostics. Existing connect and workspace dialogs are
compatibility entry points for workspace metadata and legacy association state;
they must not become native routing authorities. Routine registry writes do not
rewrite OpenClaw bindings or provider config. Native route mutations belong to
Channel Center, while the explicit surface-reconcile action is an audited,
previewed compatibility repair bridge for legacy records. Raw
bindings, config paths, peer IDs, Gateway internals, and reconciliation details
belong only in an advanced/diagnostics view.

Integrations is not a second channel registry. It may project installed
OpenClaw capabilities and non-channel integrations, while channel account and
route management belongs to Channels.

## Migration and compatibility

1. Read old workspace manifests and `channel-registry.json` through the existing
   tolerant parsers.
2. Project old group assignments into canonical route identities using the
   account ID already attached to the channel record.
3. Read new routes from OpenClaw directory/config services and merge only the
   AgentOS-owned workspace metadata required for presentation.
4. Keep structured config fallback only where a provider has no supported
   directory capability; mark its source and never treat it as runtime routing
   authority.
5. Do not rewrite or delete user configuration as part of a read migration.
6. Keep workspace registry changes metadata-only. Run the explicit surface
   reconciliation bridge only through its dry-run, preview, audit, and
   optimistic-concurrency boundary.

The compatibility boundary is intentionally observable: every directory result
has a source and fallback reason, and unavailable/unsupported results are
reported as degraded rather than presented as a successful empty directory.

## Provider capabilities and state

Capability evidence and current state are separate fields. A provider can
support multiple accounts even when the current runtime has zero or one
configured account. Capabilities are derived from OpenClaw status/plugin
declarations, provider schema, and provider config evidence; unsupported or
unknown features stay false rather than being inferred from the presentation
catalog.

State reports installation, enablement, configuration, connection, running
status, account count, account IDs, source, and an honest availability value
(`ready`, `not-installed`, `not-configured`, `degraded`, or `unknown`). A static
catalog can describe how setup works, but it cannot claim that a plugin is
installed or connected.

## Provider route surfaces

- Telegram: account -> group -> topic. Group/topic mention and access policy
  controls use native Telegram config. Topic `agentId` is provider-native.
- Discord: account -> guild -> channel -> thread. Guild, channel, and role
  entries retain hierarchy metadata. Threads inherit the parent channel;
  roles are selectors and are not flattened into conversations.
- Slack: account -> team context -> channel -> thread. Channel bindings keep
  `teamId` when OpenClaw supplies it, and threads inherit the parent channel.
- WhatsApp: account -> direct conversation or group. QR/login, logout, and
  session ownership stay with OpenClaw; AgentOS does not recreate auth state.

Directory reads are bounded and account-scoped. The application first tries
the structured OpenClaw directory transport, then a structured provider config
projection when directory support is unavailable. Config fallback is a
read-only discovery bridge, not a second routing engine. Discord log scraping
was removed from the canonical and compatibility paths because it cannot
provide an authoritative hierarchy or account scope.

## Safe mutations

Route policy updates read one provider snapshot, select the exact native route
scope, copy that scope, change only requested supported fields, and issue one
native config mutation with one `baseHash` and one `replacePaths` entry. Unknown
provider-owned siblings remain intact. A stale snapshot is returned as a
conflict so the UI can refresh instead of silently retrying or partially
applying a multi-field action. Route binding updates use the same optimistic
concurrency boundary and preserve unknown sibling binding fields.

## Custom Telegram audit

| Area | Classification | Boundary |
| --- | --- | --- |
| `telegram-coordination.ts` | Required AgentOS value | Workspace-facing prompt/context projection; it does not own runtime routing. |
| `surface-coordination.ts` | Required AgentOS value | Generic workspace coordination projection; provider semantics remain OpenClaw-owned. |
| Log parsing in `domains/channels.ts` | Removed | Directory discovery is structured OpenClaw data only; log output is not an authoritative route inventory. |
| Workspace channel registry mutation | Compatibility / AgentOS workspace metadata | Associates workspaces and legacy labels only; it does not write native bindings or provider routing config. |
| `reconcileWorkspaceSurfaceBindings` | Explicit compatibility repair | Previewed/audited bridge for legacy surface drift; never an automatic side effect of registry CRUD. |
| Telegram group config projection in channel service | Compatibility / AgentOS workspace projection | Must preserve unmanaged OpenClaw config and never become account/runtime authority. |
| Telegram session-store reconciliation | Temporary compatibility | Audited separately; it is not a replacement for native OpenClaw bindings. |
| Raw provider catalog entries | Presentation metadata | Must not claim capabilities that OpenClaw status/plugin inventory does not report. |

## Production freeze boundary

This subsystem is frozen as a consolidation boundary for the certified
OpenClaw 2026.9.4 contract. Future Channel work should be limited to upstream
contract changes, correctness fixes, security fixes, accessibility/responsive
fixes, or evidence-backed provider support. It must not introduce a second
router, account registry, policy engine, or plugin management surface.

Integrations is a read-only capability/plugin catalog. Its runtime truth comes
from OpenClaw `plugins.catalog.*` and plugin inventory responses. Channel
entries route to Channels, model entries route to Models, cron/scheduling
entries route to Operations, browser-specific entries route to Accounts, and
unknown capabilities route to the OpenClaw Control UI when a dashboard URL is
available. Installation, enablement, credential setup, and native lifecycle
remain OpenClaw-owned.

The remaining compatibility bridges are intentionally retained and bounded:

| Bridge | Classification | Removal condition |
| --- | --- | --- |
| `WorkspaceChannelGroupAssignment` and `channel-registry.json` | Read/write AgentOS workspace metadata compatibility | Remove after all supported workspace records have migrated and the legacy API has a planned deprecation window. |
| `reconcileWorkspaceSurfaceBindings` | Explicit, previewed, audited repair bridge | Remove after legacy workspace surface drift is no longer present in supported data. |
| Config-backed Telegram topic/group projection | Read-only discovery compatibility | Remove when the certified OpenClaw directory contract exposes the same structured topic/group data. |
| CLI directory transport | Explicit OpenClaw compatibility fallback | Remove when a stable native Gateway directory RPC exists and is certified. |

None of these bridges is allowed to become runtime routing authority again.
The current certification and runtime acceptance evidence is recorded in
`docs/evidence/openclaw-2026.9.4-pre-merge-final-certification.json` and
`docs/evidence/openclaw-2026.9.4-channel-runtime-acceptance.json`.

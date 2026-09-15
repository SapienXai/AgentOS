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
compatibility entry points and must call the same application services. Raw
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
4. Keep legacy log/config readers only where a provider has no supported
   directory capability; mark their source and keep them out of Telegram's
   normal path.
5. Do not rewrite or delete user configuration as part of a read migration.

The compatibility boundary is intentionally observable: every directory result
has a source and fallback reason, and unavailable/unsupported results are
reported as degraded rather than presented as a successful empty directory.

## Custom Telegram audit

| Area | Classification | Boundary |
| --- | --- | --- |
| `telegram-coordination.ts` | Required AgentOS value | Workspace-facing prompt/context projection; it does not own runtime routing. |
| `surface-coordination.ts` | Required AgentOS value | Generic workspace coordination projection; provider semantics remain OpenClaw-owned. |
| Telegram log parsing in `domains/channels.ts` | Removed from normal path | No longer used for Telegram directory discovery; Discord log parsing remains a separate compatibility path. |
| Telegram group config projection in channel service | Compatibility / AgentOS workspace projection | Must preserve unmanaged OpenClaw config and never become account/runtime authority. |
| Telegram session-store reconciliation | Temporary compatibility | Audited separately; it is not a replacement for native OpenClaw bindings. |
| Raw provider catalog entries | Presentation metadata | Must not claim capabilities that OpenClaw status/plugin inventory does not report. |

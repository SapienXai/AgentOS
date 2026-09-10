# AgentOS Phase 7.1 — Native Channel Setup

The readiness projection is aligned with the OpenClaw 2026.9.3 channel
account-state contract: `running` is the native started state, while a
configured account with no running transport is stopped. WhatsApp linking is
an authentication fact; it does not by itself claim a running listener.

Phase 7.1 activates the channel declarations recorded by Phase 6 without
changing the immutable provisioning manifest. AgentOS reads the historical
`pendingSetup.channels` entries from `.openclaw/agentos-provisioning.json` and
projects them with the latest OpenClaw native account/status response and the
AgentOS workspace channel registry.

## Three separate states

```text
Channel declaration  = historical desired setup from the validated blueprint
OpenClaw account      = provider account owned by OpenClaw
Workspace binding     = AgentOS workspace/agent routing ownership
Runtime status        = live OpenClaw account state
```

A declaration is not a connected account, and an account is not automatically
bound to a workspace. When more than one native account exists, AgentOS
requires an explicit account selection and never picks an arbitrary account.
OpenClaw `channels.status` remains authoritative for connected, running,
linked, authentication, disabled, and error states. If live status is
unavailable, the projection is unavailable rather than optimistically
connected.

Setup completion is deliberately stricter than configuration. The canonical
readiness rule is: a workspace binding exists, live native status is available,
the account is not failed/disabled, authentication is satisfied, and the
native transport is `running` or `connected`. `configured` alone is not
operational, and WhatsApp `linked` alone is not operational when the native
account is stopped. Those states remain pending and expose `Start`; a failed
or disabled account exposes `Needs attention`/`Retry`.

The workspace's ordered `agentIds` list is the authoritative routing source;
its first entry is the canonical primary agent established by provisioning.
An omitted agent selection uses only that primary. An explicit agent id that
is no longer in the workspace is rejected with a typed setup error, and an
existing binding that points outside the workspace is projected as drift
without being rewritten during status reads.

The workspace projection is available at:

```text
GET  /api/workspaces/:workspaceId/setup
POST /api/workspaces/:workspaceId/setup
```

The POST boundary only delegates to existing OpenClaw channel services and the
existing AgentOS workspace registry writer. It does not write a second channel
runtime or copy credentials into AgentOS state.

`performWorkspaceChannelSetup` keeps those production service dependencies
behind a small injectable application boundary. Executable tests exercise
configure, native QR login start/wait, binding, account selection, start/stop,
plugin restart reporting, idempotent registry updates, unavailable status, and
secret-redacted failures without replacing OpenClaw's channel ownership.

## Supported setup paths

- WhatsApp uses OpenClaw's native `web.login.start` and `web.login.wait` QR/web
  login flow. The QR value is transient UI data; it is not written to the
  provisioning manifest or setup projection.
- Telegram uses the existing native account provisioning contract with a bot
  token.
- Discord uses the existing native account provisioning contract with a bot
  token.
- Slack uses the existing native Socket Mode contract with both bot and app
  tokens. AgentOS does not store or return either token in the blueprint,
  manifest, setup status, or logs.

Google Chat, iMessage, and Signal remain unavailable in this setup surface
until their required native OpenClaw host/account flows are supported. Their
historical declarations remain visible as unavailable instead of being
silently treated as configured.

## Authorization and safety

Workspace setup mutations require the existing AgentOS workspace permission.
OpenClaw account, login, plugin, and lifecycle mutations additionally require
the existing native Gateway authorization preflight and proof. Binding an
already verified account to a workspace is an AgentOS registry mutation and
still validates the selected account against the live native snapshot.

The service resolves the workspace path from an authoritative visible Mission
Control snapshot. It never trusts a client-supplied workspace path or a client
claim that an account is connected. Secrets are accepted only by the existing
provisioning boundary and are not included in normalized setup responses.

## Capability boundary

Native Gateway search/status and local AgentOS workspace binding are separate
capabilities. Phase 7.1 does not add a custom channel runtime, QR generator,
OAuth implementation, watcher, sync engine, scheduler activation, SSH path,
or remote shell. Source synchronization remains Phase 7.2, and automation
activation remains Phase 7.3.

If OpenClaw later exposes a complete native account setup/status lifecycle for a
currently limited provider, AgentOS should prefer that Gateway capability and
keep this layer as the bounded workspace projection/orchestration boundary.

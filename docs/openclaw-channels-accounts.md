# OpenClaw Channels and Accounts

AgentOS treats OpenClaw as the runtime authority. OpenClaw owns provider
runtime, channel account credentials, authentication/link state, account
lifecycle, status, Gateway configuration, and native authorization. AgentOS
adds workspace ownership, account visibility, agent routing, policy,
preflight, recovery UX, auditing, and tenant isolation. Native Telegram bot
tokens and WhatsApp linked sessions are not copied into AgentOS persistence.

## Domain model

```text
Provider
  -> Channel Account (provider + OpenClaw accountId + name)
    -> Route (group, guild/channel, thread, DM, ...)
      -> Workspace Binding (workspaceId + accountId)
        -> Agent Binding (agentId + optional route)
```

Existing AgentOS registry records retain their persisted `id`/`channelId`
shape for compatibility. Where that value represents an OpenClaw account,
new surface records expose it as `accountId` as well. A route identifier is
never silently treated as an account identifier.

## Account lifecycle

The native Gateway RPCs are the source of truth:

- `channels.status` reads live per-account state.
- `channels.start` starts the selected provider/account runtime without
  changing authentication state.
- `channels.stop` stops the selected runtime and retains credentials and
  pairing state.
- AgentOS “Restart connection” performs `channels.stop`, then
  `channels.start`, then refreshes `channels.status`.
- `channels.logout` is destructive unlink/logout and must not be presented as
  an ordinary reconnect operation.

`channels.start` outcomes such as `handed-off`, `retry`, and `skipped` remain
visible to the AgentOS recovery surface with their native reason. Start,
stop, restart, and logout all require the existing AgentOS/OpenClaw
authorization preflight; a failed authorization check never falls through to
CLI execution.

AgentOS distinguishes configured, running, connected, linked, stopped,
disabled, failed, needs authentication, unavailable, and unknown. In
particular, configuration alone is not connected, and running/linked is not
silently promoted to provider connectivity when OpenClaw did not report it.

## WhatsApp and Telegram

WhatsApp account records may be named (`default`, `support`, and others) and
retain OpenClaw's account IDs, labels, enabled state, and default-account
resolution. QR login uses `web.login.start` and `web.login.wait`; stopping or
starting an account never starts a new login. An unlinked account shows QR
login, while a linked but stopped account shows Start and Logout.

Telegram supports multiple named accounts such as `main`, `operations`, and
`support`. AgentOS uses OpenClaw's explicit `defaultAccount` value when
present, then applies OpenClaw's named/default account rules. Account identity
comes from Gateway/config account records after `channels.add`; modern normal
operation does not inspect Telegram pairing JSON, update-offset files, token
files, or state-directory inference. Any compatibility fallback must remain
bounded, documented, and must not read credential files for secrets.

## Live status and routing

Mission Control, Integrations, Connect Channels, and Workspace Channels use
the same normalized account snapshot. Gateway `channels.status` is
authoritative for runtime state. Config-only records are retained only for
degraded/unavailable Gateway views and are labeled configured or unknown,
never connected.

Workspace and agent bindings remain AgentOS-owned policy state. OpenClaw
bindings remain executable runtime configuration. Reconcile/repair continues
to require a dry-run preview, bounded config paths, audit/backup metadata, and
native authorization before mutation.

## Browser relationship

OpenClaw controls browser runtime and native drivers:

- `openclaw`: Managed Browser.
- `existing-session`: Existing Session.
- `extension`: Chrome Extension relay.

AgentOS Secure Browser Accounts sit above those providers and own the SaaS
identity/policy layer: owner, workspace, allowed agents/domains, leases and
fencing, human login, verification, recovery, audit, and cloud worker
orchestration. Account-bound tasks must use the exact authorized browser
provider/profile and fail closed when verification, policy, lease, Gateway
dispatch, or worker availability is missing.

Browser `connected` is reserved for independently verified provider
authentication. A user clicking “I'm signed in” is recorded as
`user_confirmed`, but an unknown/unverified provider result remains
`needs_verification` and cannot dispatch an agent task.

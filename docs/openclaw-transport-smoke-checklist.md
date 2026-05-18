# OpenClaw Transport Smoke Checklist

Use this checklist after transport-layer changes and before public launch. Run the checks against a real OpenClaw install, not only mocked tests.

## Baseline

- Start AgentOS with the default environment.
- Open `Settings -> Diagnostics`.
- Confirm the `Gateway Transport` panel is visible above recent CLI command history.
- Confirm the panel shows a safe value for every field: transport mode, connection, protocol, snapshot stream, fallbacks, last connected, last disconnected.

## Scenarios

### OpenClaw Gateway Running

- Start OpenClaw Gateway normally.
- Refresh AgentOS.
- Expected UI state:
  - Transport mode: `Native WS`
  - Connection: `Connected` after the first native read
  - Protocol: `v4` for current OpenClaw builds
  - Snapshot stream: `Live`
  - Fallbacks: `0` for a clean run
  - Last native error: hidden
- Confirm dashboard initial load shows agents, sessions, and model status without repeated CLI fallback entries.

### Gateway Unavailable

- Stop or block the OpenClaw Gateway.
- Refresh AgentOS.
- Expected UI state:
  - Transport mode: `Native WS` unless native WS is explicitly disabled
  - Connection: `Closed`, `Error`, or `Idle`
  - Snapshot stream: `Live` or `Retrying` depending on the current SSE state
  - Fallbacks: increases when safe reads fall back to CLI
  - Last native error: describes the connection failure
- Confirm AgentOS remains usable through compatibility fallback where supported.

### Forced CLI Mode

- Start AgentOS with `AGENTOS_OPENCLAW_GATEWAY_CLIENT=cli`.
- Open `Settings -> Diagnostics`.
- Expected UI state:
  - Transport mode: `CLI forced`
  - Connection: `CLI forced`
  - Protocol: `Unknown`
  - Snapshot stream: `Live` after snapshot delivery
  - Last native error: hidden unless a previous snapshot carried one
- Confirm no native Gateway auth repair is required for basic CLI-backed status display.

### Native WS Disabled

- Start AgentOS with `AGENTOS_OPENCLAW_NATIVE_WS=0`.
- Open `Settings -> Diagnostics`.
- Expected UI state:
  - Transport mode: `CLI forced`
  - Connection: `CLI forced`
  - Protocol: `Unknown`
  - Fallbacks: may stay `0` because CLI is selected directly instead of used as fallback
- Confirm Gateway-native methods do not open a WebSocket.

### Missing Or Invalid Auth Token

- Configure an invalid Gateway token/password or remove required credentials for a secured remote Gateway.
- Refresh AgentOS.
- Expected UI state:
  - Transport mode: `Native WS`
  - Connection: `Error` or `Closed`
  - Fallbacks: increases for safe read calls
  - Last native error: mentions auth, token, password, unauthorized, or forbidden
- Open `Settings -> Gateway`.
- Confirm native auth status explains the credential issue without exposing secrets.

### Scope Repair Flow

- Reproduce a scope-limited local device auth state.
- Open `Settings -> Gateway`.
- Run `Repair local access`.
- Refresh `Settings -> Diagnostics`.
- Expected UI state:
  - Connection moves from `Error` or `Closed` to `Connected`
  - Protocol becomes `v4` for current OpenClaw builds
  - Last native error clears after successful native reads
- Confirm the dashboard returns to native Gateway reads.

### Gateway Restart

- From `Settings -> Gateway`, run `Restart`.
- Watch `Settings -> Diagnostics`.
- Expected UI state:
  - Connection may briefly show `Closed`, `Error`, or `Idle`
  - Last disconnected updates
  - After refresh/reconnect, connection returns to `Connected`
  - Snapshot stream remains `Live` or returns to `Live`
- Confirm AgentOS does not require a page reload after the Gateway comes back.

### Dashboard Initial Load

- Open the main dashboard in a fresh browser session.
- Expected UI state:
  - Initial loading snapshot is replaced by a live snapshot.
  - `Settings -> Diagnostics` reports `Snapshot stream: Live`.
  - Native Gateway reads do not create multiple repeated `connect` diagnostics.
- Confirm visible workspaces, agents, sessions, and model readiness render normally.

### Agent, Session, And Model Status Reads

- With Gateway running, refresh the dashboard.
- Expected UI state:
  - Agents list is populated.
  - Sessions list is populated when sessions exist.
  - Model readiness reflects configured providers.
  - `Gateway Transport` fallback count stays stable unless OpenClaw rejects a native method.

### Agent Chat Stream And Runtime Update

- Send a message through an agent chat or mission flow.
- Expected UI state:
  - Runtime/task status updates without waiting for a long polling interval.
  - `Snapshot stream` remains `Live`.
  - `Gateway Transport` remains `Connected` unless the stream subscription closes and reconnects.
- Confirm assistant output appears and completed runtime state is reflected in Mission Control.

### Onboarding Model Scan

- Run model discovery or setup from onboarding.
- Expected UI state:
  - Long-running model scan can still use CLI where Gateway does not expose equivalent behavior.
  - `Gateway Transport` may show CLI fallback or unchanged native state.
  - Recent CLI command history shows model scan activity.
- Confirm model discovery results appear and no transport error blocks completion.

## Pass Criteria

- AgentOS remains usable in native, fallback, and forced CLI modes.
- Transport state is understandable without reading server logs.
- Fallbacks are visible and explainable.
- Runtime updates arrive through Gateway-driven refresh behavior.
- No secrets appear in diagnostics, command previews, or auth error text.

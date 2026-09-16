# AgentOS reset and full uninstall

This document records the reset/uninstall boundary. OpenClaw remains the source of truth for its service, state, agents, and lifecycle. AgentOS only removes its own projection, integration markers, runtime state, and explicitly proven AgentOS-created folders.

## Audit baseline

At the start of this hardening pass, the sequence was:

1. Build a preview from the Mission Control snapshot.
2. For both reset targets, delete or detach workspace state and remove Mission Control state first.
3. For Full Uninstall, run `openclaw uninstall --all --yes --non-interactive` after that local cleanup.
4. If the OpenClaw command failed, recursively remove the configured OpenClaw paths directly.
5. Schedule package-manager shell commands and refresh the snapshot.

That order made OpenClaw cleanup non-authoritative and allowed a failed native uninstall to become a direct recursive deletion of OpenClaw state. The old path also did not include the AgentOS runtime files used for accounts, Instance Protection, gateway credentials, tokens, PID state, update cache, operator profile, or audit records.

## Current sequence

Full Uninstall is now planned and executed as:

1. Preview the current snapshot, ownership evidence, native OpenClaw dry-run, runtime allowlist, and supported install modes.
2. Run the native OpenClaw dry-run as a preflight only.
3. Run OpenClaw's native service, state, and macOS app uninstall.
4. Treat the native command's exit result as authoritative; a non-zero result stops the operation.
5. Remove AgentOS-owned workspace folders and exact AgentOS integration markers.
6. Remove AgentOS Mission Control state and the allowlisted AgentOS runtime state.
7. Schedule supported package removal with the server and launcher PIDs as wait targets.
8. Refresh what can still be read, emit the final result, and close the response stream.
9. Request the narrow runtime shutdown boundary only after the final response is closed.
10. Let the detached finalizer run after every tracked AgentOS process exits; its durable log reports per-package `succeeded`/`failed` results or an explicit `timed-out` result.

If native OpenClaw teardown fails, the operation stops. AgentOS does not recursively delete OpenClaw state and does not continue into local OpenClaw cleanup.

## Reset targets

`Reset AgentOS` removes AgentOS Mission Control settings, planner/dispatch state, browser projection state, AgentOS-managed agents, and folders whose durable filesystem record proves that AgentOS created them. It does not uninstall OpenClaw or remove OpenClaw state. Existing, imported, and unknown folders remain on disk.

`Full Uninstall` includes Reset's AgentOS-specific cleanup, but first delegates OpenClaw service, state, and app teardown to the pinned native CLI. Configured workspace directories are intentionally preserved by the native state scope so AgentOS can apply its ownership policy. Package removal can be deferred until the running server and launcher processes exit.

## Ownership policy

Every preview classifies a workspace as one of:

- `AGENTOS_OWNED`: durable AgentOS-created-empty/clone evidence, or the known AgentOS planner runtime path. A regular directory may be removed after the required native confirmation.
- `OPENCLAW_OWNED`: a path inside the configured OpenClaw state root. It is handled by OpenClaw's native lifecycle, never by a recursive AgentOS fallback.
- `USER_OWNED`: an existing or externally imported folder. The folder stays; only a regular-file `.openclaw/agentos-provisioning.json` with the verified AgentOS provisioning shape may be removed.
- `UNKNOWN`: missing, malformed, or stale ownership evidence. The folder stays and no recursive integration cleanup is attempted.

The preview and execution share the same ownership model. Execution also re-checks the filesystem before a recursive delete and refuses symlinks, protected roots, and ownership changes.

## OpenClaw and installation behavior

AgentOS currently supports OpenClaw contract version `2026.9.4`. The native plan uses:

```text
openclaw uninstall --service --state --app --yes --non-interactive
```

The `--service`, `--state`, and `--app` scopes intentionally omit `--workspace` and `--all`, preserving configured user workspace folders while allowing OpenClaw to remove its Gateway service, state, and macOS app when applicable. The official CLI dry-run is used for preview only; the uninstall command's exit result is the authoritative cleanup result. There is no direct `rm -rf ~/.openclaw` fallback.

Package cleanup is allowlisted to `pnpm`, `npm`, and `yarn` global installs, plus the AgentOS release launcher. Development/source checkouts are reported as preserved manual follow-ups, making the result partial rather than guessing or deleting a repository. Package actions use `execFile` argument arrays; the detached finalizer waits for both the bundled server and its package launcher when both exist, applies an explicit timeout, and keeps a status-only log with per-package results.

Packaged and release installations run a parent launcher plus a bundled server child. After the response stream closes, the server sends a Full Uninstall shutdown request over the launcher IPC channel; the launcher stops the child and exits after the child terminates. A source/development server without a launcher IPC channel self-signals only for Full Uninstall. Reset AgentOS never requests this shutdown.

The confirmation plan is short-lived, opaque, one-use, and bound to the authenticated actor, request session, target, and stored preview. Raw credentials are never persisted in the plan.

For the upstream contract, see the [OpenClaw v2026.9.4 uninstall CLI](https://github.com/openclaw/openclaw/blob/v2026.9.4/docs/cli/uninstall.md) and [uninstall guide](https://github.com/openclaw/openclaw/blob/v2026.9.4/docs/install/uninstall.md).

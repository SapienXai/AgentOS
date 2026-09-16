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
2. Verify the native OpenClaw preflight.
3. Run OpenClaw's native service and state uninstall.
4. Verify the native result with a second native dry-run.
5. Remove AgentOS-owned workspace folders and exact AgentOS integration markers.
6. Remove AgentOS Mission Control state and the allowlisted AgentOS runtime state.
7. Schedule supported package removal after the current AgentOS process exits.
8. Refresh what can still be read and report `succeeded`, `scheduled`, `partial`, or `failed` truthfully.

If native OpenClaw teardown fails, the operation stops. AgentOS does not recursively delete OpenClaw state and does not continue into local OpenClaw cleanup.

## Reset targets

`Reset AgentOS` removes AgentOS Mission Control settings, planner/dispatch state, browser projection state, AgentOS-managed agents, and folders whose durable filesystem record proves that AgentOS created them. It does not uninstall OpenClaw or remove OpenClaw state. Existing, imported, and unknown folders remain on disk.

`Full Uninstall` includes Reset's AgentOS-specific cleanup, but first delegates OpenClaw service and state teardown to the pinned native CLI. Configured workspace directories are intentionally preserved by the native state scope so AgentOS can apply its ownership policy. Package removal can be deferred until the running process exits.

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
openclaw uninstall --service --state --yes --non-interactive
```

The `--service` and `--state` scopes avoid the `--all` workspace scope, which would be unsafe for attached user folders. The official CLI dry-run is used for preview and post-operation verification. There is no direct `rm -rf ~/.openclaw` fallback.

Package cleanup is allowlisted to `pnpm`, `npm`, and `yarn` global installs, plus the AgentOS release launcher. Development/source checkouts are reported as preserved manual follow-ups, making the result partial rather than guessing or deleting a repository. Package actions use `execFile` argument arrays; the deferred worker waits for the current AgentOS PID and writes a status-only log.

The confirmation plan is short-lived, opaque, one-use, and bound to the authenticated actor, request session, target, and stored preview. Raw credentials are never persisted in the plan.

For the upstream contract, see the [OpenClaw v2026.9.4 uninstall CLI](https://github.com/openclaw/openclaw/blob/v2026.9.4/docs/cli/uninstall.md) and [uninstall guide](https://github.com/openclaw/openclaw/blob/v2026.9.4/docs/install/uninstall.md).

# AgentOS 0.8.0 Release Notes

AgentOS 0.8.0 is a release candidate focused on durable operator workflows,
OpenClaw alignment, and desktop reliability.

## Highlights

- Targets certified compatibility with OpenClaw 2026.9.4.
- Reconciles native OpenClaw lifecycle state across workspace and agent
  create, delete, move, recovery, and restart flows.
- Protects filesystem ownership boundaries while making workspace operations
  safer and recoverable.
- Preserves durable workspace creation activity and recovery across navigation
  and refresh.
- Improves model/provider account scoping and explicit agent ownership during
  authentication flows.
- Improves the Mission Control creation, recovery, and operator-control
  experience using real runtime state.
- Keeps the packaged Desktop shell, standalone runtime payload, updater
  metadata, and cross-platform build path version-aligned.

## OpenClaw Compatibility Impact

- Recommended and native contract target: OpenClaw `2026.9.4`.
- Supported minimum: OpenClaw `2026.9.1` with explicit security-sensitive
  session configuration.
- The release candidate is being certified against source commit
  `3a9d69db306cd7f081e06254cb89c4bcc14a7107` and the exact 2026.9.4 build
  contract. Final certification status is recorded only after the complete
  isolated certification run.
- Native Gateway/API ownership remains authoritative; existing CLI fallback
  paths stay explicit and observable.

## Security Impact

- No security-sensitive defaults are intentionally weakened.
- Filesystem ownership protection, explicit agent scoping, local operator
  authentication, and secret redaction remain in force.

## Validation

- Release-candidate validation is executed as part of the 0.8.0 release
  closure.
- Final results are recorded only after quality, certification, package,
  desktop, signing, and distribution gates complete.

## Smoke Status

- Package, Desktop, Mission Control, and OpenClaw certification smoke status:
  pending final release-closure gates.

## Known Limitations

- Production updater-key control, macOS Developer ID/notarization, and
  Windows Authenticode status must be verified before public distribution.
- OpenClaw certification must use exact disposable 2026.9.4 inputs and a
  fresh evidence provenance chain; historical PASS evidence is not reused.

## Upgrade Notes

- Requires Node.js 24.16.0+ or 26.1.0+.
- Run `agentos doctor --deep` after upgrading.

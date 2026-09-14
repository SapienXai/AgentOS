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
- The release candidate is certified against source commit
  `3a9d69db306cd7f081e06254cb89c4bcc14a7107` and the exact 2026.9.4 build
  contract. The final certification matrix passed all 20 required evidence
  families with no FAIL or UNKNOWN outcomes.
- Native Gateway/API ownership remains authoritative; existing CLI fallback
  paths stay explicit and observable.

## Security Impact

- No security-sensitive defaults are intentionally weakened.
- Filesystem ownership protection, explicit agent scoping, local operator
  authentication, and secret redaction remain in force.

## Validation

- Lint, type generation, typecheck, 1,913 tests, production build, release
  consistency, and diff checks passed.
- Exact OpenClaw 2026.9.4 contract, runtime, migration, lifecycle, identity,
  multi-user, native capability, official transport, and official production
  certification passed.
- Package tarball validation and clean temporary install smoke passed for
  `@sapienx/agentos@0.8.0`.
- Desktop shell check, package audit, packaged-server smoke, and local macOS
  `.app`/`.dmg` build completed. The updater signing step was blocked because
  the local environment has no private updater key.

## Smoke Status

- Package, Desktop, Mission Control, and OpenClaw certification smoke passed.
- Mission Control smoke used an isolated exact 2026.9.4 Gateway and disposable
  workspace; no user Gateway or production state was used.

## Known Limitations

- Public distribution is blocked until the updater public key is confirmed as
  organization-controlled and the corresponding private key is available to
  the release workflow.
- The local macOS build is ad-hoc and has no Developer ID/notarization. Windows
  Authenticode and cross-platform Desktop artifacts were not produced locally.
- OpenClaw certification must use exact disposable 2026.9.4 inputs and a
  fresh evidence provenance chain; historical PASS evidence is not reused.

## Upgrade Notes

- Requires Node.js 24.16.0+ or 26.1.0+.
- Run `agentos doctor --deep` after upgrading.

# AgentOS 0.6.6 Release Notes

AgentOS 0.6.6 is a release-readiness polish build for the packaged local control plane. It does not add new product features.

## Highlights

- Adds packaged API token authentication for local AgentOS server access.
- Keeps local security settings explicit: loopback binding by default, centrally protected API routes, authenticated launcher URLs, and owner-only permissions for sensitive local auth/config files where applicable.
- Blocks remote OpenClaw Gateway URLs by default unless `AGENTOS_ALLOW_REMOTE_GATEWAY_URL=1` is set explicitly.
- Hardens account/browser-profile documentation around the current MVP bridge: AgentOS can read and launch through OpenClaw-reported browser profiles, but OpenClaw does not yet expose typed browser-profile dispatch or verified website account identity.
- Keeps `requires_approval` account rules persisted but blocked until approval dispatch exists.
- Verifies package smoke through `pnpm smoke:agentos-package`, including npm tarball content checks, package install, `agentos --version`, `agentos doctor`, and `agentos doctor --deep`.
- Reaffirms Node.js 24 or newer as the required runtime for local, CI, release, and package-manager smoke runs.
- Documents compatibility with OpenClaw `2026.5.28` or newer compatible stable builds.

## Verification

Run before publishing:

```bash
pnpm lint
pnpm typegen
pnpm typecheck
pnpm test
pnpm build
pnpm check:release
pnpm smoke:agentos-package
```

Run on a real local OpenClaw stable install before announcing the release:

```bash
agentos doctor --deep
```

Also complete the physical-machine clean-install checklist:

```text
docs/agentos-clean-install-smoke-checklist.md
```

## Known Limitations

- `agentos doctor --deep` must complete cleanly against a real local stable OpenClaw install before release announcement; package smoke can only verify the CLI path and read-only diagnostics behavior.
- Clean-install smoke remains a manual physical-machine step because it depends on local OpenClaw Gateway auth, operator scopes, model credentials, browser profile state, and provider state.
- Account-target browser-profile dispatch remains an MVP bridge until OpenClaw exposes typed browser-profile dispatch.
- `requires_approval` account rules are saved as policy state but cannot dispatch account-target tasks until approval dispatch exists.
- Surface repair remains preview-first; review audit, backup, affected paths, and restore instructions before applying.

## Publish Preparation

Do not publish until all automated checks pass and the manual OpenClaw/clean-install verification is complete.

NPM:

```bash
pnpm publish:agentos
```

GitHub release assets:

```bash
git tag agentos-v0.6.6
git push origin agentos-v0.6.6
```

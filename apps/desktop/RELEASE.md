# AgentOS Desktop release readiness

The desktop version is checked against `packages/agentos/package.json`. `pnpm desktop:check` fails if the Tauri config, Cargo manifest, and published AgentOS package versions diverge.

## Updater signing

`tauri.conf.json` contains the updater verification key and points to the GitHub Release asset named `latest.json`. Production releases must provide:

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

The private key must never be committed or printed. The public key currently in the configuration was generated outside the repository for local artifact validation. Before the first production release, replace it with the long-lived organization-controlled public key and store its matching private key in the release environment. A local signed artifact is not evidence of production key control.

## Update ownership and supported bundles

The Updates page installs signed updates only for macOS ARM64 `.app`, Windows
x64 NSIS, and Linux x64 AppImage bundles. Debian and RPM Desktop builds can
check the signed feed, then delegate installation to their package manager.
Development shells and unidentified bundles do not receive an install action.
The native shell owns checking, signature verification, download, embedded
server shutdown, installation, relaunch, and version reconciliation. The web
application can only request a one-time native operation prepared by the
authenticated AgentOS update API.

The first release containing this flow must be installed manually over older
Desktop versions. Back up the existing AgentOS workspace and sidecar data
before that upgrade, then verify it after the new build starts. The bounded
storage migration retains its source and stops update admission when it finds
conflicting or unverifiable roots.

## GitHub Actions

- `desktop.yml` validates all three platforms and intentionally produces unsigned PR artifacts when release signing secrets are unavailable.
- `desktop-release.yml` is a reusable signed-artifact build called by `release-agentos.yml`. It uploads platform bundles and does not create or finalize a GitHub Release.
- `release-agentos.yml` is the sole public release finalizer. It waits for CLI and Desktop build jobs, validates all required installers, CLI archives and signatures, builds `latest.json`, and only then creates the release.
- `scripts/desktop/finalize-release-assets.mjs` rejects missing or duplicate platform files, absent signatures, invalid CLI checksums, and incomplete release asset matrices.

The workflow requires `TAURI_SIGNING_PRIVATE_KEY` and
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. The public key currently in the
configuration was generated outside the repository for local artifact
validation. The matching organization-controlled key and CI secret access have
not been verified here, so this code does not establish that existing Desktop
installs can trust a future release.

macOS production distribution additionally requires Developer ID certificate and notarization credentials. The local `.app`/DMG build is not called Developer ID signed or notarized unless those credentials are present and the workflow reports successful signing/notarization.

Windows Authenticode signing is separate from Tauri updater signing and must be added to the organization's release environment before claiming a signed Windows installer.

Linux packages require the WebKitGTK/AppIndicator/Rsvg build dependencies listed in the workflow. Runtime users need a compatible WebKitGTK desktop environment and a system browser for external HTTP(S) links.

The native host starts only the packaged AgentOS server on loopback, retries a bounded set of startup port collisions, and waits up to five seconds during shutdown. Unix builds send the standalone server `SIGTERM` so Next.js can drain its listener; Windows uses the platform-native child termination behavior and retains the bounded wait plus explicit force fallback. The host never owns or stops the separate OpenClaw Gateway process.

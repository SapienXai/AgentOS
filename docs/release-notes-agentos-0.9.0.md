# AgentOS 0.9.0

## Highlights

- Setup keeps OpenClaw diagnostics and model settings available on demand so the next action stays visible.
- The setup guide leads from a verified model connection to creating the first workspace and starting a conversation with its agent.
- Agent chat reports a model context overflow as a failed turn and explains how to retry.
- CLI release installs and updates require valid SHA-256 checksums before replacing the installed application.

## OpenClaw compatibility

AgentOS 0.9.0 starts with OpenClaw 2026.11.5. Run `agentos doctor --deep` to verify Gateway connectivity, authentication, scopes, and model readiness.

## Install and get started

Use the CLI installer for your platform or select a checksum-verified archive from the release assets. Run `agentos start` and open the URL it prints. In Setup, choose **Connect ChatGPT** to authorize in your browser, or connect another supported provider. Create a workspace and send your first message to its agent.

The OpenAI authorization page opened in a clean profile. Completing authorization and getting a ChatGPT-backed reply still require an account holder's consent. The first workspace, real agent reply, and follow-up were verified with a local model on OpenClaw 2026.11.5.

## Platform downloads

- **CLI** is the stable distribution. The published assets list shows the macOS, Windows, and Linux packages that passed their individual checks. Install 0.9.0 from GitHub Releases.
- **Desktop Public Preview** installers are available separately for platforms that pass their minimum package checks. Windows Preview requires manual installation and lacks Authenticode signing. Linux x64 DEB Preview requires manual installation. Preview packages are excluded from stable Desktop auto-update. Tauri updater signature verification remains enabled.
- **macOS Desktop** is withheld pending Apple Developer ID signing, notarization, and Gatekeeper acceptance. The macOS CLI is a separate distribution.
- **Linux AppImage and RPM** are withheld pending successful packaged launch on supported systems.
- **Mobile PWA** runs from an AgentOS instance. Android home-screen installation and an authenticated agent reply passed. iPhone-sized WebKit sign-in and chat passed. Native iOS home-screen installation remains unverified.

See the [download page](https://agentos.sapienx.app/download) for available packages and the [acceptance record](https://github.com/SapienXai/AgentOS/blob/main/docs/evidence/agentos-0.9.0-production-acceptance.json) for validation details.

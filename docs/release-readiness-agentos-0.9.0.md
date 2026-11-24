# AgentOS 0.9.0 production readiness

24 November 2026. Candidate code `6520429582bf753f984520ef3e570017cda0ca0f`.

**Public release policy.** The OpenClaw runtime passed certification. Each CLI platform must pass its clean-install and update checks. The publication workflow accepts a recorded check only when its SHA-256 matches the original release bytes. Desktop packages with a verified launch qualify for Public Preview while distribution signing or update acceptance is pending. Stable Desktop requires full acceptance. [Publication workflow](https://github.com/SapienXai/AgentOS/actions/workflows/publish-agentos.yml)

## OpenClaw and CI

AgentOS 0.9.0 is the first production baseline. The installer, supported minimum, recommendation, native contract, and Railway deployment use OpenClaw 2026.11.5. OpenClaw owns the Gateway, authentication, sessions, and runtime state. AgentOS owns onboarding, platform packaging, admission to its updater, and release policy. The clean certification uses disposable state and preserves existing external files.

The exact 2026.11.5 package and separately published Gateway client and protocol packages matched the upstream release and npm integrity. The final candidate passed all 18 required certification artifacts. The fresh Gateway recorded 59 passing probes, 13 expected authorization denials, and 13 optional skips. The official production-runtime rehearsal recorded 46 passes, one expected denial, and 24 environment-limited skips. A concurrent identity run reported a Gateway error on session creation. The isolated retry passed, including the expected read-only denial and the authorized write. [Final certification](evidence/openclaw-2026.11.5-pre-merge-final-certification.json) · [Fresh Gateway](evidence/openclaw-2026.11.5-runtime-certification.json) · [Official runtime](evidence/openclaw-2026.11.5-final-official-runtime-certification.json)

Release Watch now reviews only the newest stable release present in both upstreams. The dry run generated one intake for 2026.11.7. npm marked 2026.11.8 latest without matching GitHub stable release metadata. The earlier candidate rehearsal found session archive and delete failures on 2026.11.8. The 2026.11.7 intake remains pending certification. [Release Watch run](https://github.com/SapienXai/AgentOS/actions/runs/45387882253) · [OpenClaw 2026.11.7](https://github.com/openclaw/openclaw/releases/tag/v2026.11.7)

CI previously failed because the 2026.11.5 certification artifact was absent. The artifact is now committed, and certification freshness remains required. A release job exposed a race in cleanup of a test's durable config queue. The test now waits for the persisted queue to empty. The Windows desktop job also exposed an updater method call that the locked Tauri API does not support. The installer now uses the existing embedded server shutdown before handing the already-verified update to Tauri. [Passing initial main CI](https://github.com/SapienXai/AgentOS/actions/runs/45387881857) · [Certified code CI](https://github.com/SapienXai/AgentOS/actions/runs/45389710450) · [Acceptance-document CI](https://github.com/SapienXai/AgentOS/actions/runs/45390789151) · [Windows compiler failure](https://github.com/SapienXai/AgentOS/actions/runs/45387319077/job/138421548115) · [Final desktop runner validation](https://github.com/SapienXai/AgentOS/actions/runs/45389223666)

## Desktop packages

| Platform | Production acceptance | Observed evidence |
| --- | --- | --- |
| macOS ARM64 | FAIL | Built the 0.9.0 DMG, verified the image, mounted it, copied the app into a fresh staging directory, and verified the ad hoc bundle seal. The packaged server smoke and 13 Rust shell tests passed. The first headless DMG run stopped in Finder layout setup. The CI-mode build completed, and the final DMG SHA-256 was `7218a7547ad2f9b44a14c80b0678d110f1a5618ef7baa375a01ee8d531820098`. Gatekeeper rejected the ad hoc app. Developer ID signing, notarization, and signed update installation remain required. |
| Windows x64 | PUBLIC PREVIEW | The native Windows runner installed the unsigned NSIS package and started the installed Desktop app. Its embedded loopback server returned HTTP 200. A timestamped Authenticode signature and a signed update rehearsal remain required for stable. [Windows installation and launch](https://github.com/SapienXai/AgentOS/actions/runs/45404109050/job/138480512322) |
| Linux x64 | BLOCKED | The final Linux desktop runner passed the native build and packaged-server smoke. The earlier staging AppImage signature verified with the production updater public key, and an altered copy failed verification. The emulated x64 host rejected the static AppImage wrapper. The extracted signed payload launched and served /login with HTTP 200. The DEB signature, clean installation, and HTTP 200 startup passed. The RPM signature and clean installation passed on Fedora 45 x64. Fedora GTK aborted before the server started when its sandboxed icon loader exited in the container. Direct AppImage execution, RPM launch on a native host, and a signed update rehearsal remain due. |

The release build smoke-tested four CLI archives and built all three desktop platforms. It verified the CLI SHA-256 checksums and all five desktop updater signatures against the bundled public key. The publication job checks the original artifact, CI on `main`, current certification, and evidence for each channel. The protected `agentos-public-release` environment allows the publication job from `main` and requires a release owner. [Release build](https://github.com/SapienXai/AgentOS/actions/runs/45389230270) · [Protected release environment](https://github.com/SapienXai/AgentOS/settings/environments)

## CLI packages

| Platform | Production acceptance | Observed evidence |
| --- | --- | --- |
| macOS ARM64 | PASS | Native Apple Silicon, macOS 27.0.1, Node.js 24.22.1. The original archive verified against the checksum from the release build. `node packages/agentos/scripts/smoke-package.mjs --tarball <path>/agentos-darwin-arm64.tgz --check-update` printed `AgentOS package smoke passed for @sapienx/agentos@0.9.0`. The SHA-256 is recorded in the acceptance file. |
| macOS x64 | PASS | Clean install, deep doctor, and read-only update check. [Intel runner](https://github.com/SapienXai/AgentOS/actions/runs/45404109050/job/138480511858) |
| Windows x64 | PASS | Clean install, deep doctor, and read-only update check. [Windows runner](https://github.com/SapienXai/AgentOS/actions/runs/45404109050/job/138480512221) |
| Linux x64 | PASS | Clean install, deep doctor, and read-only update check. A separate Linux x64 run served the login route and stopped cleanly. [Linux runner](https://github.com/SapienXai/AgentOS/actions/runs/45404109050/job/138480511815) |

The hosted CLI matrix ran against the candidate JavaScript bundle. The final source change affected the native desktop updater. [CLI packaging and smoke](https://github.com/SapienXai/AgentOS/actions/runs/45387312968)

## Mobile PWA and onboarding

| Surface | Production acceptance | Observed evidence |
| --- | --- | --- |
| Android PWA | PASS (Android 16 emulator) | Added AgentOS to the launcher from Android Chrome and opened it from the launcher. The standalone window retained the authenticated session, ran the service worker, and received a real agent reply over HTTP 200. |
| iOS PWA | BLOCKED | The iOS 27 Simulator opened the login page in Safari. In iPhone-sized WebKit, the authenticated session, standalone manifest, active service worker, and real agent reply passed. Native Safari Home Screen installation and authenticated standalone relaunch remain required. |
| ChatGPT onboarding | BLOCKED | From an isolated fresh instance, protected owner setup and the simplified UI reached the real `auth.openai.com` consent page. A test account still has to approve token sharing and complete the first workspace and reply through ChatGPT. |
| Local model onboarding rehearsal | PASS | The packaged web app created a real workspace and primary agent. Ollama returned the first reply. An authenticated browser reloaded the saved chat history and sent it through the normal follow-up request, and the agent recalled the earlier prompt. |

Website download links are deployed after the corresponding public assets return HTTP 200. [Download page](https://agentos.sapienx.app/download)

## Release-owner actions

- In Apple Developer, create or export the **Developer ID Application** certificate and create an app-specific password for notarization. Set repository secrets `APPLE_CERTIFICATE` (base64 of the exported P12), `APPLE_CERTIFICATE_PASSWORD`, `APPLE_ID`, and `APPLE_PASSWORD`. Set Actions variables `APPLE_SIGNING_IDENTITY` and `APPLE_TEAM_ID`. [Tauri macOS distribution signing](https://v2.tauri.app/distribute/sign/macos/)
- In Azure Artifact Signing, finish organization identity validation and create a Public Trust certificate profile. Confirm the organization meets Public Trust eligibility and give the CI app registration the Artifact Signing Certificate Profile Signer role scoped to that profile. Set repository secret `AZURE_CLIENT_SECRET` and Actions variables `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_ARTIFACT_SIGNING_ENDPOINT`, `AZURE_ARTIFACT_SIGNING_ACCOUNT`, and `AZURE_ARTIFACT_SIGNING_CERTIFICATE_PROFILE`. [Tauri Windows distribution signing](https://v2.tauri.app/distribute/sign/windows/) · [Microsoft Public Trust eligibility](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart)
- Complete **Continue with ChatGPT → Open ChatGPT** in a clean QA instance with a dedicated ChatGPT test account and approve token sharing. An iPhone or a controllable iOS simulator is still needed to verify the Add to Home Screen path against a trusted QA origin.
- For an open-source Windows signing alternative, apply to SignPath Foundation with the public repository, published release history, and documented signing policy. Eligibility includes an OSI-approved license, verified project reputation, source-to-binary provenance, role separation, and MFA. Foundation acceptance and the project's signing approvals are required before an artifact can carry that signature. [SignPath Foundation terms](https://signpath.org/terms)

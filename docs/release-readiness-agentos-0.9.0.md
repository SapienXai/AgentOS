# AgentOS 0.9.0 production readiness

24 November 2026. Candidate code `6520429582bf753f984520ef3e570017cda0ca0f`.

**Public release decision — NO-GO.** The OpenClaw runtime passed certification. Public release acceptance requires production-signed installers, a native signed update rehearsal, iOS Home Screen validation, and the completed ChatGPT authorization path.

## OpenClaw and CI

AgentOS 0.9.0 is the first production baseline. The installer, supported minimum, recommendation, native contract, and Railway deployment use OpenClaw 2026.11.5. OpenClaw owns the Gateway, authentication, sessions, and runtime state. AgentOS owns onboarding, platform packaging, admission to its updater, and release policy. The clean certification uses disposable state and preserves existing external files.

The exact 2026.11.5 package and separately published Gateway client and protocol packages matched the upstream release and npm integrity. The final candidate passed all 18 required certification artifacts. The fresh Gateway recorded 59 passing probes, 13 expected authorization denials, and 13 optional skips. The official production-runtime rehearsal recorded 46 passes, one expected denial, and 24 environment-limited skips. A concurrent identity run reported a Gateway error on session creation. The isolated retry passed, including the expected read-only denial and the authorized write. [Final certification](evidence/openclaw-2026.11.5-pre-merge-final-certification.json) · [Fresh Gateway](evidence/openclaw-2026.11.5-runtime-certification.json) · [Official runtime](evidence/openclaw-2026.11.5-final-official-runtime-certification.json)

Release Watch now reviews only the newest stable release present in both upstreams. The dry run generated one intake for 2026.11.7. npm marked 2026.11.8 latest without matching GitHub stable release metadata. The earlier candidate rehearsal found session archive and delete failures on 2026.11.8. The 2026.11.7 intake remains pending certification. [Release Watch run](https://github.com/SapienXai/AgentOS/actions/runs/45387882253) · [OpenClaw 2026.11.7](https://github.com/openclaw/openclaw/releases/tag/v2026.11.7)

CI previously failed because the 2026.11.5 certification artifact was absent. The artifact is now committed, and certification freshness remains required. A release job exposed a race in cleanup of a test's durable config queue. The test now waits for the persisted queue to empty. The Windows desktop job also exposed an updater method call that the locked Tauri API does not support. The installer now uses the existing embedded server shutdown before handing the already-verified update to Tauri. [Passing initial main CI](https://github.com/SapienXai/AgentOS/actions/runs/45387881857) · [Certified code CI](https://github.com/SapienXai/AgentOS/actions/runs/45389710450) · [Acceptance-document CI](https://github.com/SapienXai/AgentOS/actions/runs/45390789151) · [Windows compiler failure](https://github.com/SapienXai/AgentOS/actions/runs/45387319077/job/138421548115) · [Final desktop runner validation](https://github.com/SapienXai/AgentOS/actions/runs/45389223666)

## Desktop packages

| Platform | Production acceptance | Observed evidence |
| --- | --- | --- |
| macOS ARM64 | FAIL | Built the 0.9.0 DMG, verified the image, mounted it, copied the app into a fresh staging directory, and verified the ad hoc bundle seal. The packaged server smoke and 13 Rust shell tests passed. The first headless DMG run stopped in Finder layout setup. The CI-mode build completed, and the final DMG SHA-256 was `7218a7547ad2f9b44a14c80b0678d110f1a5618ef7baa375a01ee8d531820098`. Gatekeeper rejected the ad hoc app. Developer ID signing, notarization, and signed update installation remain required. |
| Windows x64 | BLOCKED | The first native Windows job caught the updater compiler error. The fix is on main. The fixed Windows runner passed the Rust shell tests, packaged-server smoke, and unsigned NSIS build. A timestamped Authenticode signature and a signed installer/update rehearsal remain required. |
| Linux x64 | BLOCKED | The final Linux desktop runner passed the native build and packaged-server smoke. The earlier staging AppImage signature verified with the production updater public key, and an altered copy failed verification. The emulated x64 host rejected the static AppImage wrapper. The extracted signed payload launched and served /login with HTTP 200. The DEB signature, clean installation, and HTTP 200 startup passed. The RPM signature and clean installation passed on Fedora 45 x64. Fedora GTK aborted before the server started when its sandboxed icon loader exited in the container. Direct AppImage execution, RPM launch on a native host, and a signed update rehearsal remain due. |

The final staging workflow built and smoke-tested four CLI archives and built all three desktop platforms. Its asset validation verified the CLI SHA-256 checksums and all five desktop updater signatures against the bundled public key. The separate distribution-signing input requires an approved source ref and can build signed candidates while publication is disabled. The public job requires current certification, platform acceptance for the certified commit, final asset verification, and approval through the `agentos-public-release` environment. That environment is restricted to `agentos-v*` tags and has a required release owner. [Staging release workflow](https://github.com/SapienXai/AgentOS/actions/runs/45389230270) · [Protected release environment](https://github.com/SapienXai/AgentOS/settings/environments)

## CLI packages

| Platform | Production acceptance | Observed evidence |
| --- | --- | --- |
| macOS ARM64 | PASS | Clean npm installation from the packaged 0.9.0 archive, package smoke, and read-only update check. |
| macOS x64 | BLOCKED | The native Intel GitHub runner built and installed the 0.9.0 CLI and passed deep doctor. A native update check is outstanding. |
| Windows x64 | BLOCKED | The native Windows GitHub runner built and installed the 0.9.0 CLI and passed deep doctor. A native update check is outstanding. |
| Linux x64 | PASS | GitHub archive checksum verified. A fresh Linux x64 container installed the package, reported 0.9.0, ran the update check, served the login route with HTTP 200, and stopped cleanly. |

The hosted CLI matrix ran against the candidate JavaScript bundle. The final source change affected the native desktop updater. [CLI packaging and smoke](https://github.com/SapienXai/AgentOS/actions/runs/45387312968)

## Mobile PWA and onboarding

| Surface | Production acceptance | Observed evidence |
| --- | --- | --- |
| Android PWA | PASS (Android 16 emulator) | Added AgentOS to the launcher from Android Chrome and opened it from the launcher. The standalone window retained the authenticated session, ran the service worker, and received a real agent reply over HTTP 200. |
| iOS PWA | BLOCKED | The iOS 27 Simulator opened the login page in Safari. In iPhone-sized WebKit, the authenticated session, standalone manifest, active service worker, and real agent reply passed. Native Safari Home Screen installation and authenticated standalone relaunch remain required. |
| ChatGPT onboarding | BLOCKED | From an isolated fresh instance, protected owner setup and the simplified UI reached the real `auth.openai.com` consent page. A test account still has to approve token sharing and complete the first workspace and reply through ChatGPT. |
| Local model onboarding rehearsal | PASS | The packaged web app created a real workspace and primary agent. Ollama returned the first reply. An authenticated browser reloaded the saved chat history and sent it through the normal follow-up request, and the agent recalled the earlier prompt. |

The live download page and website main branch still serve the five existing 0.8.0 asset links. Each returned HTTP 200. The 0.9.0 link switch is ready for use after the 0.9.0 assets exist and are verified. [Download page](https://agentos.sapienx.app/download) · [Website production deployment](https://vercel.com/coin-collect-team/agentos/2ENFBoN58jX1Y19fewE8hzXJUFSX)

## Release-owner actions

- In Apple Developer, create or export the **Developer ID Application** certificate and create an app-specific password for notarization. Set repository secrets `APPLE_CERTIFICATE` (base64 of the exported P12), `APPLE_CERTIFICATE_PASSWORD`, `APPLE_ID`, and `APPLE_PASSWORD`. Set Actions variables `APPLE_SIGNING_IDENTITY` and `APPLE_TEAM_ID`. [Tauri macOS distribution signing](https://v2.tauri.app/distribute/sign/macos/)
- In Azure Artifact Signing, finish organization identity validation and create a Public Trust certificate profile. Confirm the organization meets Public Trust eligibility and give the CI app registration the Artifact Signing Certificate Profile Signer role scoped to that profile. Set repository secret `AZURE_CLIENT_SECRET` and Actions variables `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_ARTIFACT_SIGNING_ENDPOINT`, `AZURE_ARTIFACT_SIGNING_ACCOUNT`, and `AZURE_ARTIFACT_SIGNING_CERTIFICATE_PROFILE`. [Tauri Windows distribution signing](https://v2.tauri.app/distribute/sign/windows/) · [Microsoft Public Trust eligibility](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart)
- Complete **Continue with ChatGPT → Open ChatGPT** in a clean QA instance with a dedicated ChatGPT test account and approve token sharing. An iPhone or a controllable iOS simulator is still needed to verify the Add to Home Screen path against a trusted QA origin.
- After the signed artifact and account tests pass, approve the protected public release job. Enable the website 0.9.0 download links after the released assets respond successfully.

No public tag or package publication was performed.

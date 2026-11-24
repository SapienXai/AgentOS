# AgentOS 0.9.0 production readiness

24 November 2026 · Candidate code `6d6f90f0` · Baseline `origin/main` at `5184b1df`

**Public release remains NO-GO.** The candidate builds locally. The production acceptance gate is closed.

## Platform evidence

| Surface | Result | Observed evidence |
| --- | --- | --- |
| macOS ARM64 Desktop | FAIL | Built and verified a DMG, copied the app from the mounted image to a fresh directory, and verified the ad hoc bundle seal. Packaged server smoke and 13 Rust tests passed. Gatekeeper rejected the ad hoc signature. Developer ID notarization and the 0.8.0 in-app upgrade remain outstanding. |
| Windows x64 Desktop and CLI | BLOCKED | Release jobs require installer Authenticode verification and Windows package smoke. No Windows installation or upgrade was exercised. |
| Linux x64 Desktop | BLOCKED | A Linux x64 container exercised the CLI. Desktop AppImage, DEB and RPM installation and signed update remain outstanding. |
| CLI on macOS ARM64 and Linux x64 | PASS | Both package smokes passed. On both platforms, installed the published 0.8.0 npm archive, created an owner and profile, upgraded to the candidate, and signed in again to read the existing profile. On macOS the shell installer also rejected an altered checksum and retained the installed package and state using a controlled download fixture. The Linux package and macOS DMG rehearsals preceded the final chat-only fix. |
| Mobile PWA | BLOCKED | iPhone-sized WebKit and Android-sized Chromium verified protected login, the onboarding action and the standalone manifest. The candidate production package registered an active service worker. Physical home-screen installation and account-to-first-reply acceptance remain outstanding. |
| ChatGPT onboarding | BLOCKED | Protected owner setup and OpenAI authorization launch passed against an isolated OpenClaw 2026.11.5 runtime. ChatGPT account consent, first workspace provisioning through that connection, and the first ChatGPT reply remain outstanding. |

The 0.8.0 published macOS updater archive verified with the public key bundled in the candidate. The new feed preserves the platform keys used by the 0.8.0 updater. A signed 0.9.0 application update still requires native platform acceptance.

An authenticated request to the packaged AgentOS API created a real workspace and primary agent. A local Ollama rehearsal reproduced a context overflow. The candidate now reports that terminal state as a failed chat turn. After raising the context limit in the disposable test runtime, the agent returned the expected first reply. AgentOS read the saved transcript and the next request reproduced the normal product history handoff. The agent recalled the word from the earlier turn. A separate direct request with no history did not recall it. These checks used Ollama for inference.

## OpenClaw selection

Retain 2026.11.5 as the candidate runtime and leave the certified recommendation at 2026.9.7 until final certification passes. Gateway protocol 4 and the pinned package identities remain the supported integration boundary.

| OpenClaw | Result | Evidence |
| --- | --- | --- |
| 2026.11.5 | PASS for the exercised runtime checks | The runtime harness recorded 59 passes, 13 expected denials and 13 skips. Exact Gateway lifecycle, operator authorization, session continuity, 2026.9.1 migration, native Doctor recovery, and the official production transport cutover passed. The cutover report covers candidate code `6d6f90f0`. |
| 2026.11.7 | PASS for the exercised runtime checks | Matching runtime counts. Exact Gateway lifecycle, authorization, session continuity and 2026.9.1 migration and recovery passed. Two Gateway read methods gained write-scope requirements in the static comparison. |
| 2026.11.8 | FAIL in runtime certification | npm moved its latest tag during the review. The intake could verify the npm identity, while GitHub release metadata was unavailable. The runtime report failed archive and delete-after-archive because the session was still active. Separate identity, session-continuity and official lifecycle tests passed. |

## CI and publication

- Local lint, route generation, type checking, 2,254 tests, production build, release consistency, simulated compatibility, and package smoke ran. GitHub workflow syntax was validated with actionlint.
- The GitHub CI failure on `main` comes from missing final OpenClaw 2026.11.5 evidence. Local production release validation fails on the same missing artifact. The native runtime reports describe individual suites. The failed CI and watcher runs are recorded in the [CI run](https://github.com/SapienXai/AgentOS/actions/runs/44486935082) and [Release Watch run](https://github.com/SapienXai/AgentOS/actions/runs/45195084982).
- Release Watch now includes the newest release when the backlog exceeds its bound, accepts an exact manual target, and parses profile-dependent Gateway access. Dry-run intakes for 2026.11.5 and 2026.11.7 completed. The scheduled-equivalent run still reports the failed historical 2026.10.5 evidence and missing 2026.11.8 upstream release metadata.
- Public publishing requires a manual dispatch against a matching tag from `main`, a protected `agentos-public-release` environment with reviewers, current OpenClaw final certification, platform acceptance bound to the candidate commit, and verified release signatures. The environment returned HTTP 404 when inspected. No publish was attempted.
- The website candidate build rendered all five 0.9.0 download URLs using the release asset naming convention. The public download page can continue serving the 0.8.0 assets while the candidate awaits approval.

To pass the gate, commit the current OpenClaw final certification and `docs/evidence/agentos-0.9.0-production-acceptance.json`. The acceptance file must record `version`, the full `candidateCommit`, and platform `checks` containing each `status` and its HTTPS `evidence` link. The exact acceptance requirements are defined in `scripts/check-production-release.ts`. Use signed desktop artifacts and evidence from the actual platform and account flows.

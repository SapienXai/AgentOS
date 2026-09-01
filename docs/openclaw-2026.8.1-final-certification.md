# OpenClaw 2026.8.1 Final Certification

This document defines the final regression and certification boundary for the AgentOS `upgrade/openclaw-2026.8.1` branch. It covers the first-stable roadmap gates after the lifecycle, identity, trusted-team multi-user, session/task, and automation/cron phases.

## Scope

The certified runtime is OpenClaw `2026.8.1` at source commit `ea806575e6450e4d1efdfc72c19f04be982a1b9b`, build `2026.8.1-ea806575e645-2026-08-31T00-16-08.235Z`. Certification uses an exact disposable package fixture, loopback-only model fixture, isolated state, and disposable Gateway ports. The user’s existing Gateway, credentials, cookies, and runtime state are out of scope and must not be touched.

AgentOS remains the human control and product-policy layer. OpenClaw remains the runtime, Gateway, role/scope, session, task, agent, and cron authority. AgentOS uses a shared trusted backend Gateway connection; it does not claim native per-human OpenClaw Gateway delegation or manufacture OpenClaw credentials. Human attribution is preserved in AgentOS audit records, while OpenClaw runtime attribution remains shared-service where that is the exact connection identity.

## Regression cleanup

The five baseline failures were classified before editing:

| Area | Root cause | Resolution |
| --- | --- | --- |
| Inspector visual tones | test expected an older RGB/token representation | assert the current light and dark surface tokens and their distinction |
| Mobile inspector scope controls | source-shape test required an obsolete class order and omitted conditional visibility | use order-tolerant current classes and assert the chat-view condition |
| Mobile workspace creation | source-shape test required the former dialog class order | assert the current mobile viewport classes independent of order |
| Mission sidebar modes | source-shape test expected one dynamic aria-label although the implementation uses explicit mobile overlay controls | assert the actual close/open controls and handlers |
| Settings hash navigation | source-shape test omitted the current section grouping metadata | assert the current `Core` group and hash resolver |

No implementation regression was identified in these five areas. The final suite must report `1063` tests, `1063` passes, and `0` failures. A different result fails final certification.

## Final command

Run the certification with explicit package roots:

```bash
OPENCLAW_FINAL_CERTIFICATION_PACKAGE=/absolute/path/to/openclaw-2026.8.1/package \
OPENCLAW_FINAL_CERTIFICATION_SOURCE_PACKAGE=/absolute/path/to/openclaw-2026.6.11/package \
pnpm openclaw:final-certification
```

The runner executes the full test/build/release matrix, all disposable OpenClaw E2Es, and simulated compatibility. It records command status and sanitized evidence only. It does not store command output, passwords, tokens, cookies, provider credentials, raw prompts, raw conversations, or private disposable paths in the final artifact.

## Required gates

The final artifact must prove:

- the full AgentOS suite is green with no new failures;
- fresh exact 8.1 baseline and runtime certification pass;
- 6.11 → 8.1 migration and rollback pass;
- lifecycle, identity/authorization, trusted-team multi-user, session/task, and automation/cron gates pass;
- restart/reconnect continuity remains covered by the affected runtime evidence;
- expected authorization denials remain classified as expected denials;
- shared-service privilege cannot be inherited by a member through AgentOS;
- task cancellation is either positively proven with an exact task ID or recorded as `SKIPPED-runtime-timing` when the disposable runtime is already terminal;
- evidence is sanitized and the user’s Gateway is untouched.

The final gate is:

`OPENCLAW 2026.8.1 FINAL CERTIFICATION: PASS`

## Release and merge boundary

This phase does not bump the AgentOS version, publish npm packages, tag a release, deploy, merge `main`, or force-push. It produces development-branch certification and merge-readiness evidence only. The final branch must remain `upgrade/openclaw-2026.8.1`, with local and remote branch heads equal and a clean worktree.

Mutually untrusted tenants still require separate AgentOS security domains and separate OpenClaw Gateway/state/credentials. That is not claimed or implemented by this certification.

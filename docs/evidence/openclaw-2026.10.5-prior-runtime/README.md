# OpenClaw 2026.10.5 Prior Runtime Observations

These original JSON outputs were archived from `/tmp/openclaw-2026.10.5-certification/` on 2026-10-20. They record isolated disposable runtime probes and preserve both successful observations and the initial failed migration attempt.

Artifacts that declare `codeCommitUnderTest` or `agentosStartingHead` bind to AgentOS commit `9c330b76eaa10cfbf3961c19d4b9f69c86132c05`. Other artifacts retain their original provenance fields and do not name an AgentOS code HEAD. These observations predate later contract and certification-policy commits. The current final-certification aggregate does not count them as current-code evidence.

The probes used disposable OpenClaw state and loopback services. They did not use a production Gateway or live provider/channel credentials. See `openclaw-2026.10.5-upgrade-plan.md` for the current validation results and remaining certification blockers.

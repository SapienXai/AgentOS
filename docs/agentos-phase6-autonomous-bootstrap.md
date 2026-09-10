# AgentOS Phase 6 — Autonomous Bootstrap & Verification

Phase 6 turns an accepted `WorkspaceBlueprint` into a real workspace through a server-side, actor-scoped provisioning run. Architect generation remains side-effect-free for the final user workspace; the only runtime side effect in this phase is the intentional bootstrap of the approved workspace after the operator chooses `Create Workspace`.

## Application boundary

The authoritative entry point is:

```text
POST /api/workspaces/provision
  → startWorkspaceProvisioning({ actorId, blueprint, draftContextId, expectedKnowledgeGenerationId, idempotencyKey })
  → lib/agentos/application/workspace-provisioning-service.ts
  → lib/openclaw/application/workspace-service.ts
```

The API derives ownership from the authenticated AgentOS permission boundary. A browser request cannot provide an actor identity, workspace path, OpenClaw state, or an already-authorized provisioning claim. The server validates the complete blueprint, draft acceptance, materialization target, staged context ownership, and knowledge freshness before any final workspace mutation.

## Provisioning lifecycle

Runs are persisted below `.mission-control/workspace-provisioning-runs` with a schema version, actor hash, exact validated blueprint snapshot, blueprint fingerprint, idempotency identity, attempt, progress, completed-step evidence, warnings, error, and final result. Run records are created and updated with atomic JSON writes. An owner-aware lease records the executor PID, host, start identity, heartbeat, and attempt; live leases block another executor, while dead/stale leases can be reclaimed safely. This is the durable cross-process boundary; the in-memory map is only a same-process optimization.

```text
pending
  → validating
  → materializing
  → bootstrapping
  → promoting-knowledge
  → provisioning-agents
  → binding-knowledge
  → applying-capabilities
  → recording-declarations
  → verifying
  → ready | partial | failed
```

`ready` means the physical workspace, selected agents, bootstrap documents, AgentOS provisioning manifest, and required native bindings were verified without warnings. `partial` means the core workspace is usable but setup or capability work remains. `failed` preserves a bounded diagnostic and never claims that the workspace is ready. A terminal state is written only after the final sidecar manifest has been atomically written, so status polling cannot observe completion before its durable evidence exists.

Provisioning accepts an internal `AbortSignal`. If cancellation arrives after a side effect has started, the durable run is marked `cancelled` with the truthful message that the workspace may be incomplete and can be resumed; AgentOS does not perform a destructive rollback.

## Materialization and bootstrap ownership

AgentOS reuses OpenClaw’s canonical `createWorkspaceProject` boundary for the workspace directory, scaffold documents, project manifest, and selected agent creation. It does not create an alternative workspace format or duplicate OpenClaw’s agent lifecycle. The blueprint’s selected skills and tools are applied through the existing AgentOS `updateAgent` boundary after creation. The Architect’s hidden planner runtime is never copied into the user workspace.

## Knowledge promotion and native memory

An actor-owned staged corpus is promoted with the existing `promoteKnowledgeCorpus` boundary into the new workspace. The service then calls `ensureWorkspaceNativeKnowledge`, which binds the workspace corpus to each selected agent through OpenClaw native memory. OpenClaw remains the owner of indexing, embeddings, search, and memory storage. If index maintenance is unavailable because the Gateway is remote or runtime locality is unproven, the workspace is still represented honestly as partial/degraded; AgentOS never runs a local CLI against an unknown runtime.

## Setup declarations

Blueprint channels, connections, and automations are recorded as pending setup in `.openclaw/agentos-provisioning.json` and in the durable run record. Phase 6 does not authenticate a channel, create an external account, activate a scheduler, or fabricate a live connection. WhatsApp QR/session setup and token/service-account setup for other supported channels remain later OpenClaw-owned setup operations.

## Verification and recovery

Verification reads the physical workspace, canonical OpenClaw project manifest, AgentOS provisioning manifest, authoritative Mission Control snapshot, selected agent IDs, scaffold documents, and native knowledge result. A failed verification produces `failed` with a specific bounded issue. `GET /api/workspaces/provision?runId=...` rehydrates the exact stored blueprint and resumes a non-terminal run, so a process restart does not require the original request body. Completed-step evidence and the canonical OpenClaw idempotency record let retries repair only the missing or unverified boundary. Lease loss stops further mutation; the replacement executor must reacquire ownership first.

The client polls `GET /api/workspaces/provision?runId=...` and renders the server-reported steps and live signals as animated chips. Closing the dialog can leave the server run in progress; any caller that retains the run identifier can recover its durable status. The success action is `Open Workspace`, while a partial result remains usable and shows its pending setup.

## Roadmap boundary

Phase 6 ends at verified bootstrap. Phase 7 will own source synchronization, connection lifecycle, and later operational integrations. Phase 6 does not implement a custom watcher, indexer, embedding store, remote shell, SSH fallback, final authentication, or autonomous operations activation.

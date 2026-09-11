# Workspace Intelligence Phase 9.1 Certification

Phase 9.1 hardens the production boundary between immutable workspace analysis, accepted workspace intelligence, and later provisioning updates. It does not add a crawler, Project Intelligence Agent, Architect 2.0, Composer redesign, or a second runtime owned by AgentOS.

## Authority and ownership

- `ProjectFact` is the canonical factual claim layer. Pack identity, overview, and collection values are validated projections over those claims.
- Evidence owns proof and deterministic verification qualification. A claim or resource owns its interpretation; verification is epistemic qualification, not a provenance shortcut.
- `WorkspaceBlueprint` is the reviewed architecture decision. `WorkspaceCompositionPlan` is its materialization plan.
- `WorkspaceProvisioningRun` remains the sole authoritative lifecycle for workspace mutation.
- The intelligence binding is a small AgentOS sidecar that records the exact accepted Project Intelligence generation, blueprint, composition, and provisioning run for one actor/workspace pair.
- OpenClaw remains the owner of workspace/runtime bootstrap and native operational state. AgentOS reads the native snapshot through its existing adapter boundary.

## Immutable reanalysis

Refreshing a review-ready creation run creates a deterministic child run and child draft context. The parent run, its context, uploaded intake, review result, and any accepted workspace remain unchanged. The refresh fingerprint includes the parent generation, reviewed blueprint/composition identity, and bounded refresh intent; concurrent requests with the same intent converge on one child run and one child context.

Context cloning uses the existing protected creation-context storage. It copies normalized declarations and staged upload files only after bounded file-count, per-file, aggregate-size, path, regular-file, and hash checks. Temporary files are mode `0600`, copied with bounded streams, synced, and removed on failure. No second upload store or raw-source model is introduced.

## Semantic drift and accepted binding

Drift compares semantic views rather than mutable generation metadata. Project facts compare category, key, normalized claim value, and verification; resources compare category, kind-aware canonical locator, and verification; conflicts compare status and semantic subjects. Blueprint agent views include role, name, persistence, primary status, purpose, responsibilities, outputs, skill/tool assignments, and policy, while excluding evidence references and explanatory justification. Blueprint operations retain their operational fields while excluding evidence references; memory and safety retain enforced fields while excluding rationale and notes. Composition views omit plan identity, input fingerprints, timestamps, model metadata, and evidence references where those do not change the operator-facing decision. Meaningful artifact order remains intact in composition output; set-like collections are compared deterministically.

Knowledge writer ownership uses an atomic two-part filesystem protocol. A complete owner record is written and synced to a private candidate, then published with a non-overwriting hard link. An owner-specific heartbeat file is updated atomically, so a late stale owner cannot overwrite a newer lock. A short-lived control guard serializes publication, stale recovery, and release; its unique owner file means late cleanup cannot remove a replacement guard. Readers treat an initializing control guard as busy and malformed fully published records as corruption, preserving fail-closed behavior.

The accepted binding is written atomically under an exclusive lock and uses a compare-and-set predecessor (`expectedCurrentProvisioningRunId`). Actor identity and workspace identity are independently scoped with strong hashes. A stale provisioning run cannot overwrite a newer accepted binding; a malformed, cross-actor, mismatched, or legacy binding is treated as unknown rather than trusted. Provisioning captures the predecessor before workspace mutation and does not expose a terminal ready snapshot until binding persistence has completed.

Context retention reuses the existing six-hour TTL. Cleanup retains contexts referenced by active creation/provisioning runs, accepted live bindings, and recent review-ready lineage; abandoned expired contexts remain eligible for cleanup. This prevents a live baseline from being deleted without introducing a second storage or retention system.

The status service exposes `current`, `update-available`, `partial`, and `unknown`. It compares a candidate against the accepted live binding and never auto-applies a candidate. No binding means unknown, not current.

## Recovery and compatibility

Creation execution remains activated by the existing `ensureCreationRunExecution` path during start, authorized reads/polling, and active-run listing. Leases and run-level mutation locks prevent duplicate local owners. If an OpenClaw Architect outcome is in-flight or ambiguous after interruption, the run fails closed with a bounded diagnostic; AgentOS does not create a duplicate remote model turn. Native OpenClaw compatibility is therefore preserved as an adapter boundary and must still be verified in an authenticated environment for a live remote turn.

## Validation boundary

Untrusted material retains its existing ingestion/source boundary:

`raw untrusted source → parsing/extraction → normalized candidate domain object → strict Project Intelligence validation`

Strict fields and secret redaction apply to normalized domain contracts and protected persistence. Public identifiers remain representable. No raw-source abstraction is added for this certification.

## Certification coverage

The Phase 9.1 certification covers:

- creation through Project Intelligence, Architect, Composer, review-ready state, and provisioning;
- immutable no-change and changed-network reanalysis;
- semantic drift against the live accepted binding;
- operator-owned workspace content preservation during an approved update;
- binding CAS and concurrent initial-write behavior;
- tampered or missing binding behavior through the status boundary;
- bounded failure diagnostics, OpenClaw ownership, and exclusion of Phase 3–9 runtime scope.

The repository validation commands and their observed results are recorded in the completion report for the corresponding Phase 9.1 commit pair.

# Create Workspace continuity and freshness

AgentOS keeps Create Workspace analysis separate from provisioning. A
`WorkspaceCreationRun` owns intake, project-context staging, Project
Intelligence, Architect, Composer, review, and the provisioning handoff. A
`WorkspaceProvisioningRun` is the only lifecycle that owns materialization,
OpenClaw bootstrap, agent creation, knowledge promotion, and final workspace
verification.

## Durable intake boundary

Multipart bytes are read through the existing bounded upload helpers. The
request is bounded before form parsing, each file is bounded while its stream
is read, and aggregate file/source limits are checked again before durable
write. Uploaded bytes are written beneath the protected
`workspace-create/<actor-hash>/<draft-context-id>` context store before the
creation endpoint acknowledges the run. The background executor opens the
durable files by their stored manifest; it never relies on a `Request`,
`FormData`, or in-memory upload buffer after the request ends. Expired context
cleanup removes the protected context, including staged upload roots.

The untrusted-source boundary remains:

```text
raw untrusted source -> parsing/extraction -> normalized candidate domain object -> strict Project Intelligence validation
```

No second raw-source abstraction is introduced.

## Continuity and revision

The Create Workspace review surface revises through
`POST /api/workspaces/creation-runs/:runId/revise`. The request carries only
operator instruction, edits, and constraints. The server loads the
actor-owned durable run, blueprint result, staged context, validated Project
Intelligence pack, and current composition plan. It persists the new canonical
blueprint and a new composition plan before returning review state. A revised
blueprint without a matching composition plan is never returned as a usable
Create Workspace result.

Revision lineage is represented by the run snapshot. The previous blueprint
fingerprint remains recorded, while the new plan uses a revision-specific
Composer run identity. Review-ready runs are resumable; failed and cancelled
runs are not returned by the resumable-run query. Opening an active run calls
`ensureCreationRunExecution`, which acquires the existing lease, reclaims a
stale owner, preserves attempt identity, and fails closed if an OpenClaw
outcome is ambiguous. It never starts a duplicate remote model turn.

## Freshness and drift

Freshness is deterministic and dependency-based, not age-based. A change in
source declarations, a knowledge generation, a Project Intelligence pack, a
blueprint, the reviewed composition plan, or an inspected file inventory can
make a downstream artifact stale. The statuses are `fresh`, `stale`,
`unknown`, and `partial`; `partial` means usable upstream evidence exists but
coverage is incomplete.

An explicit refresh creates a new immutable creation run with a parent lineage
reference and reuses the existing protected context. Websites and repositories
may be re-fetched through the existing ingestion pipeline; uploaded bytes are
not fabricated or copied into a second upload store. Refresh never mutates a
live workspace. Provisioning performs its existing server-side canonical
checks again immediately before side effects.

Drift summaries are bounded structured metadata covering facts, resources,
conflicts, blueprint decisions, composition, and managed file inventory. Raw
model responses, prompts, and hidden reasoning are never persisted in the
summary.

After successful provisioning, AgentOS records an internal
`WorkspaceIntelligenceBinding` containing the workspace, source generation,
Project Intelligence generation, blueprint fingerprint, composition plan
fingerprint, and provisioning run. Evidence and OpenClaw remain authoritative
for proof and runtime behavior respectively; the binding is an AgentOS
projection used for freshness and drift interpretation.

# Workspace Intelligence Architecture

This document defines the Phase 1 Project Intelligence foundation. It is a
normalized, versioned AgentOS domain contract for future discovery and
workspace-architecture work. It does not implement discovery, verification,
transport, Workspace Architect runtime, Workspace Composer, or OpenClaw
runtime behavior.

## Ownership and boundaries

The long-term flow is:

```text
OpenClaw workspace/source conventions
        ↓
existing AgentOS ingestion and source abstractions
        ↓
parsing and extraction (future)
        ↓
normalized Project Intelligence candidate
        ↓
strict Project Intelligence validation
        ↓
ProjectIntelligencePack
        ↓
Workspace Architect (future projection)
        ↓
WorkspaceBlueprint (existing architecture contract)
        ↓
OpenClaw-native workspace materialization
```

Raw HTML, JSON-LD, connected-source payloads, ingestion metadata, and other
imported source material are untrusted input. They are not required to match
the normalized Project Intelligence object shape. Phase 1 does not add a new
raw-source abstraction; future extraction can reuse the existing
`WorkspaceKnowledgeSource` and ingestion contracts where appropriate.

Project Intelligence is an AgentOS knowledge sidecar/projection. It is not a
credential store, crawler, verifier service, task engine, memory engine, or
replacement for OpenClaw runtime state.

## Canonical authority

The domain uses one direction of authority:

- `ProjectFact` is the canonical factual CLAIM layer and owns the claim.
- `EvidenceRef` owns bounded proof and deterministic verification
  qualification.
- Verification represents epistemic qualification of a claim or resource.
- Scalar and collection projections are validated views over canonical claims.
- `ProjectConflict` is canonical conflict representation and is orthogonal to
  verification and pack readiness.
- `OfficialResource` owns resource interpretation and discovery/origin
  metadata, but has no independent trust source.

`ProjectValue<T>` is intentionally split into `ProjectScalarValue<T>` and
`ProjectCollectionValue<T>`:

- Scalar projections require every referenced fact to agree with the
  normalized projected scalar.
- Collection projections use normalized membership/set semantics for support
  and consistency. A fact may contribute distinct members. Presentation and
  ranking order is retained, stable first-seen deduplication is allowed during
  normalization, and validation never alphabetically sorts or mutates the
  collection.
- Neither projection may introduce a value not supported by its referenced
  canonical facts.

## Evidence and verification

Evidence has three distinct properties:

1. An `EvidenceRef` exists in the pack.
2. A claim/resource links to it with a `supports` relationship.
3. The evidence has a deterministic qualification capability.

The qualification capability is not hard-coded to first-party origin. The
Phase 1 contract supports authoritative first-party evidence, explicitly
qualified official uploaded documents, and authoritative connected sources.
Operator-only declarations, unknown external sources, discovered external
references, inferred claims, unsupported evidence, and merely existing
evidence cannot qualify an external claim as verified.

Phase 1 validates this boundary but does not implement the future verifier.

For an `OfficialResource`, `verification` is an interpretation validated from
its evidence relationships. Its `origin` field only describes how the
resource was discovered. A resource-level trust field is deliberately not
part of the contract.

## Conflicts and readiness

`ProjectConflict` records competing fact/resource subjects, their evidence,
confidence, and resolution status. Conflict is not a verification state. A
verified claim can participate in an open conflict with another claim.

Pack readiness is limited to:

- `empty`: no meaningful intelligence content exists;
- `partial`: some intelligence or unknowns exist, but the pack is incomplete;
- `ready`: the normalized pack is usable for a downstream consumer.

Conflict counts and open-conflict state are derived from `conflicts` with
`getProjectConflictSummary`; `conflicted` is not a mutually exclusive pack
state.

## Discovery contracts

`DiscoveryRun.state` describes lifecycle:

`pending | running | ready | partial | failed | cancelled`

`DiscoveryRun.phase` describes execution phase:

`discovery | fetch | extraction | synthesis | finalization | null`

`DiscoveryEvent.phase` uses only the execution-phase type. Event payloads are
structured and transport-independent. Phase 1 adds no SSE, polling,
WebSocket, crawler, or durable execution implementation.

## Normalization and validation

Normalization functions are the mutation-free input preparation boundary in
the sense that they return new normalized values: they canonicalize bounded
text, redact secrets through the existing AgentOS redaction utility, dedupe
IDs, and preserve intentional collection order.

Validation functions are deterministic and non-mutating. They validate only
normalized Project Intelligence domain objects, reject unsupported fields at
those boundaries, enforce references and projection consistency, and prevent
credential-like fields from bypassing the typed contract.

Public identifiers remain representable when they are public and evidence-
backed, including blockchain contract addresses, network identifiers,
package IDs, application IDs, repository identifiers, and public API URLs.

## Golden standard

The test fixtures are deterministic and have no live internet dependency:

- `CoinCollect` exercises a Web3-shaped project, public contract identifiers,
  official resources, and a stale conflicting external claim.
- `OrbitDesk` exercises a generic SaaS product without blockchain fields.
- `RiverKit` exercises documentation-heavy open-source software with website,
  API documentation, and repository evidence.

These fixtures are evaluation inputs for the future Project Intelligence
Agent. They do not hard-code Web3 assumptions into the domain and do not
implement production discovery or synthesis logic.

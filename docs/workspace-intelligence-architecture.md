# Workspace Intelligence Architecture

This document defines the Phase 1 Project Intelligence foundation, the Phase
2 creation-runtime boundary, and the Phase 3 deterministic discovery
boundary. It is a normalized, versioned AgentOS domain contract for evidence
collection and workspace-architecture work. Phase 2 adds reliable
observation around the existing context and Architect path; Phase 3 adds
bounded website discovery; Phase 3.1 hardens its resource, policy, and
locator boundaries. None of these phases implements verification,
Workspace Architect 2.0, Workspace Composer, or a parallel OpenClaw runtime.

## Ownership and boundaries

The long-term flow is:

```text
OpenClaw workspace/source conventions
        ↓
existing AgentOS ingestion and source abstractions
        ↓
deterministic Project Discovery Engine (Phase 3)
        ↓
parsing and extraction (future)
        ↓
normalized Project Intelligence candidate
        ↓
strict Project Intelligence validation
        ↓
ProjectIntelligencePack (future approved input)
        ↓
Workspace Architect
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

Phase 3 uses separate deterministic website fixtures for CoinCollect, a
generic SaaS site, and documentation-heavy software. They exercise root and
subdomain traversal, metadata/navigation/footer harvesting, sitemaps,
external candidate preservation, contact discovery, canonicalization, and
bounded security behavior without live network access.

## Existing Create Workspace flow

Phase 1 does not change the existing Create Workspace runtime. Its current
flow remains:

```text
Create Workspace → context staging → ingestion → bounded corpus → Workspace Architect → WorkspaceBlueprint → review → provisioning → OpenClaw workspace → knowledge promotion
```

Project Intelligence is an additive normalized sidecar. It does not replace
WorkspaceBlueprint, alter provisioning, or claim ownership of OpenClaw
workspace materialization.

## Phase 3 Project Discovery Engine

Project Discovery is a deterministic evidence-collection boundary between
declared sources and the existing knowledge corpus. It does not synthesize a
`ProjectIntelligencePack`, decide truth, verify official ownership, or use an
LLM. Its output is a bounded `ProjectDiscoveryManifest` containing observed
pages, candidates, contacts, metadata, relationships, fetch status, and
warnings. These are discovered candidates, not verified official resources.

Website traversal uses a public-suffix-aware registrable-domain check. The
root host and explicitly policy-approved subdomains such as `docs`,
`developers`, `api`, `help`, and `support` may be crawled within the same
source limits. `app`, `www`, and `blog` are shallow, useful candidates;
infrastructure-like subdomains such as `cdn`, `static`, `assets`, `status`,
and `tracking` are recorded but not recursively crawled by default. A naïve
hostname suffix match is not used, so lookalikes such as
`project.org.attacker.example` remain outside the site family.

Every fetch remains behind the existing AgentOS HTTP, DNS, public-address,
redirect, byte, page, depth, concurrency, and total-run bounds. Redirects and
new hostnames are revalidated. External links such as repositories, social
profiles, explorers, support platforms, and document hosts are retained with
their source-page provenance but are never recursively crawled. Mail and
telephone links are normalized as contact candidates and are never fetched.

Robots policy and a bounded set of sitemap/index locations are inspected
before page scheduling. Malformed robots and sitemap material is ignored as a
bounded discovery miss. Navigation, footer, canonical, alternate/meta,
OpenGraph, Twitter, title, JSON-LD type, contact, document, and application
signals are harvested before navigation/footer/body cleanup. JSON-LD is
bounded, parsed without execution, and remains untrusted observation data.

The scheduler uses deterministic priority signals so root, documentation,
developer, product, support, contact, security, integration, and similar
project surfaces are favored over boilerplate, archives, and pagination. URL
normalization removes fragments, default ports, and common tracking or
credential-like parameters while preserving benign query parameters. Safe
display locators remove query strings and fragments before entering
`WorkspaceCreationRun` events or snapshots; durable locators preserve safe
identity-bearing query parameters for manifests and evidence.

The static fetch path is the default. Low-information JavaScript shell pages
are detected with bounded deterministic signals. No new browser runtime is
created: because the current server-side discovery boundary has no approved
rendered-fetch capability, the manifest records an explicit unavailable
fallback warning and continues with whatever static evidence is usable.

Discovered pages are projected into the existing protected knowledge corpus;
the bounded manifest is stored alongside the knowledge generation state for
future extraction without rescanning raw HTML. Phase 3 does not create a
second memory system, raw-source abstraction, verifier, fact extractor, or
Project Intelligence Agent. Phase 4 may consume these manifests to perform
structured extraction and official-source verification.

## Phase 3.1 discovery hardening

The discovery engine uses one `ProjectDiscoverySourceByteBudget` per source.
Robots, sitemap/index, redirect, and page responses reserve capacity before
fetching, receive that reservation as their maximum body size, and settle the
reservation with actual bytes. Unused capacity is released; failed requests
are accounted for conservatively. The invariant
`committed + reserved <= capacity` is maintained even while page batches run
concurrently, so document-level limits cannot multiply into an unbounded
source total.

All URL-derived discovery paths use the same typed crawl policy:
`crawl`, `shallow`, `record-only`, or `blocked`. Root and `www` hosts are
normal, documentation/developer/API/help/support subdomains are high-value,
`app` and `blog` are shallow, and infrastructure subdomains are recorded
without crawling. Sitemap and robots declarations, canonical links, anchors,
and JSON-LD links cannot bypass this policy.

JSON-LD is treated as untrusted observation material. It is parsed without
execution under bounded script, object, depth, array, and string limits.
Names, URLs, contact observations, application categories, operating systems,
and repository/documentation candidates retain page provenance; malformed or
instruction-shaped content is ignored. New manifests use schema version 2;
the validator remains read-compatible with version 1 manifests, whose absent
JSON-LD observation fields are treated as empty by consumers.

## Phase 2 creation execution

`WorkspaceCreationRun` is an AgentOS orchestration sidecar for the
pre-provisioning path only. Its lifecycle is:

`pending | running | review-ready | failed | cancelled`

Its execution stages cover intake, context staging, source ingestion,
Architect runtime preparation/reasoning/validation, and review preparation.
There is deliberately no provisioning stage. A creation run may record a
`provisioningHandoffReady` flag and `provisioningRunId`, but
`WorkspaceProvisioningRun` remains the only authoritative provisioning
lifecycle.

Creation runs are durable JSON records with an actor-scoped idempotency key,
protected `draftContextId`, bounded attempt diagnostics, a current snapshot,
and versioned structured events. Events are retained to a maximum of 256 per
run; the snapshot remains authoritative when older events are truncated.
Events contain stable codes and structured fields rather than UI sentences.

The transport is durable polling. Initial multipart intake returns `202` only
after upload bytes and intake metadata have been persisted through the
existing protected workspace-creation context storage. The background
executor reopens those files by actor and draft context; it never depends on
request/FormData memory. Existing context and provisioning routes remain
compatible.

One configurable overall analysis deadline governs context staging and
Architect execution. Context staging is bounded by both the existing
ingestion limit and the budget required to preserve an Architect reserve.
Architect attempts consume the remaining shared deadline, so independent
timeout stacks cannot extend the run beyond its overall budget.

Failure diagnostics separate category, stable failure code, and retryability.
Authorization, invalid configuration/request, unsupported capability, and
ambiguous remote execution are terminal. Temporary transport/provider
failures are transient; structured-output failures are repairable; explicit
cancellation is cancelled. Diagnostics are redacted and bounded.

When usable evidence survives incomplete context staging, the run records
`context.status = partial` and `architect.partialContext = true`. Architect
may continue, but the review presenter must expose that the architecture was
generated from partial project context. Partial coverage is never silently
treated as full readiness.

Creation recovery is activated by `ensureCreationRunExecution(runId)` during
initial creation, actor-authorized active polling, and reload recovery. It
uses an atomic lease and the stable `${creationRunId}:${attempt}` Architect
idempotency identity. The OpenClaw adapter contract is the authority for
whether interrupted remote execution can be replayed safely; ambiguous
outcomes fail closed rather than creating a duplicate turn.

## Future intelligence roles

The future system separates responsibilities at explicit boundaries:

- The Project Intelligence Agent will discover and synthesize normalized
  candidate claims from bounded source material. Its runtime is out of scope
  for Phase 1.
- Workspace Architect will consume approved intelligence and produce the
  existing WorkspaceBlueprint contract. Architect runtime changes are out of
  scope for Phase 1.
- AI Workspace Composer is a later composition layer that may use approved
  intelligence and architecture to propose workspace artifacts. Composer,
  retrieval, persistence, and UI runtime are out of scope for Phase 1.

OpenClaw remains the runtime, orchestration, agent, tool, model, session, and
gateway owner. AgentOS provides the operator-facing control and normalized
domain layer above it.

## OpenClaw workspace document semantics

Future workspace composition must preserve the established OpenClaw document
roles rather than inventing parallel runtime concepts:

- `AGENTS.md` describes workspace operating instructions and constraints.
- `SOUL.md` describes the agent's durable character and interaction posture.
- `IDENTITY.md` describes the agent identity presented to operators and users.
- `USER.md` records relevant user context and preferences.
- `MEMORY.md` contains durable promoted memory according to the applicable
  OpenClaw memory rules.

Phase 1 models none of these documents and does not write them. Future phases
must define their source, approval, promotion, and recovery boundaries before
implementing composition.

## Phase boundaries

Phase 1 and Phase 1.1 establish normalized claims, evidence qualification
semantics, projections, conflicts, source-coverage invariants, lifecycle
contracts, fixtures, and validation. Phase 3 establishes deterministic
bounded project discovery and its corpus/creation-progress projection. The
following remain future work:

- Phase 4+: structured extraction, synthesis, official-resource verification,
  and any Project Intelligence Agent runtime;
- later phases: verification runtime, retrieval, persistence, refresh,
  transport/event streaming, Workspace Architect evolution, and AI Workspace
  Composer;
- all phases: no duplicate OpenClaw runtime, model, tool, session, gateway, or
  workspace ownership inside AgentOS.

Source identifiers are intentionally opaque in this foundation. Phase 1 checks
their internal consistency across facts, evidence, resources, coverage, and
pack provenance, but does not resolve them against `WorkspaceKnowledgeSource`
until the future ingestion integration defines that boundary.
